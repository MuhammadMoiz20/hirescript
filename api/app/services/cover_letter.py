"""Cover letter generator.

Sonnet-backed short-form generation. Grounds the letter in the user's
:class:`Profile` and the top-6 KB chunks for the posting's description so
the model has concrete facts to reach for instead of inventing them.
"""

from __future__ import annotations

import json
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Company, JobPosting, Profile as ProfileModel
from app.schemas.profile import Profile
from app.services import kb_ingest
from app.services.agent import query_text


log = logging.getLogger(__name__)


_SYSTEM_PROMPT = """\
You are writing a cover letter for {legal_name}.

Strict rules:
- <=250 words. Plain prose only — no headers, no bullets, no markdown.
- No clichés ("I am writing to express my interest…", "I am excited to apply…").
- Use the KB notes below for tone, voice, and concrete content. Never invent
  facts — if a claim is not supported by the profile or KB notes, leave it out.
- Output ONLY the letter. No preamble, no signature line, no commentary.
"""


def _format_kb_chunks(chunks: list[dict]) -> str:
    if not chunks:
        return "(no KB notes available)"
    lines = []
    for i, c in enumerate(chunks, start=1):
        text = (c.get("text") or "").strip()
        if not text:
            continue
        source = c.get("source", "unknown")
        title = c.get("title", "untitled")
        lines.append(f"--- chunk {i} (source={source}, title={title}) ---\n{text}")
    return "\n".join(lines) if lines else "(no KB notes available)"


def _format_profile(profile: Profile) -> str:
    p = profile.preferences
    return json.dumps(
        {
            "legal_name": profile.legal_name,
            "preferred_name": profile.preferred_name,
            "links": profile.links,
            "preferences": {
                "role_families": p.role_families,
                "company_stages": p.company_stages,
                "work_modes": p.work_modes,
            },
        },
        ensure_ascii=False,
    )


async def generate_cover_letter(
    db: AsyncSession,
    *,
    user_id: int,
    posting_id: int,
) -> str:
    """Generate a cover letter for ``posting_id``.

    Returns the letter text (single block, plain prose).
    """
    posting = (
        await db.execute(
            select(JobPosting).where(JobPosting.id == posting_id)
        )
    ).scalar_one()

    company_name = "(unknown)"
    if posting.company_id is not None:
        company_row = (
            await db.execute(
                select(Company).where(Company.id == posting.company_id)
            )
        ).scalar_one_or_none()
        if company_row is not None:
            company_name = company_row.display_name

    profile_row = (
        await db.execute(select(ProfileModel).where(ProfileModel.user_id == user_id))
    ).scalar_one_or_none()
    profile_data = profile_row.data if profile_row is not None else {"legal_name": ""}
    profile = Profile.model_validate(profile_data)

    chunks = await kb_ingest.retrieve(
        db,
        user_id=user_id,
        query=posting.description_text or posting.title,
        k=6,
    )

    description = (posting.description_text or "")[:3000]
    user_prompt = (
        f"Posting: {company_name} - {posting.title}\n\n"
        f"Description:\n{description}\n\n"
        f"Profile (JSON): {_format_profile(profile)}\n\n"
        f"KB notes:\n{_format_kb_chunks(list(chunks))}\n"
    )

    text = (
        await query_text(
            system_prompt=_SYSTEM_PROMPT.format(
                legal_name=profile.legal_name or "the candidate"
            ),
            user_prompt=user_prompt,
            tier="sonnet",
        )
    ).strip()
    word_count = len(text.split())
    if word_count > 250:
        log.warning(
            "cover letter exceeded 250-word soft cap (got %d words)",
            word_count,
        )
    return text
