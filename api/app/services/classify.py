"""Posting classification.

Scores a :class:`JobPosting` against the single-tenant user's profile
preferences using Haiku and writes the resulting tier / fit score /
rationale onto the row.

This is a primitive: orchestration (running it after ingestion, batching,
scheduling) lives in the runner.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Company, JobPosting, Profile as ProfileModel
from app.schemas.profile import Profile
from app.services.agent import AgentError, query_json

VALID_TIERS = {"dream", "targeted", "wide_net", "skip"}


_SYSTEM_PROMPT = """\
You are scoring how well a job posting fits Moiz's preferences.

Return ONLY a JSON object matching:
{"tier": "dream"|"targeted"|"wide_net"|"skip", "fit_score": <int 0-100>, "rationale": "<<=200 chars>"}

Tier rules:
- "skip" if the posting matches a dealbreaker, or fit_score < 40.
- "wide_net" if fit_score is 40-59.
- "targeted" if fit_score is 60-84.
- "dream" if fit_score >= 85, OR the title/role aligns strongly with role_families AND the company is top-tier prestige.

Strict JSON only, no markdown fences, no commentary.
"""


def _format_preferences(profile: Profile) -> str:
    p = profile.preferences
    return (
        f"salary_floor_usd={p.salary_floor_usd}, "
        f"salary_target_usd={p.salary_target_usd}, "
        f"role_families={p.role_families}, "
        f"dealbreakers={p.dealbreakers}, "
        f"company_stages={p.company_stages}, "
        f"work_modes={p.work_modes}"
    )


def _build_user_prompt(
    posting: JobPosting, company_name: str, profile: Profile
) -> str:
    description = (posting.description_text or "")[:4000]
    return (
        f"Job: {company_name} - {posting.title} - "
        f"{posting.location or '(unspecified location)'}\n\n"
        f"Description:\n{description}\n\n"
        f"Moiz's preferences: {_format_preferences(profile)}\n"
    )


async def classify_posting(db: AsyncSession, *, posting_id: int) -> dict[str, Any]:
    """Classify ``posting_id`` against the single-tenant profile preferences.

    Loads the posting + ``Profile`` row for ``user_id=1``, calls Haiku, and
    writes ``tier``, ``fit_score``, ``classification_rationale`` onto the
    posting (and flips ``status="classified"`` if it was still ``"new"``).

    Returns the raw classification dict for runner consumption.
    Raises :class:`AgentError` on invalid model output.
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
        await db.execute(select(ProfileModel).where(ProfileModel.user_id == 1))
    ).scalar_one_or_none()
    profile_data = profile_row.data if profile_row is not None else {"legal_name": ""}
    profile = Profile.model_validate(profile_data)

    user_prompt = _build_user_prompt(posting, company_name, profile)
    raw = await query_json(
        system_prompt=_SYSTEM_PROMPT,
        user_prompt=user_prompt,
        tier="haiku",
    )

    tier = raw.get("tier")
    fit_score = raw.get("fit_score")
    rationale = raw.get("rationale")

    if tier not in VALID_TIERS:
        raise AgentError(f"classify_posting: invalid tier {tier!r}")
    if not isinstance(fit_score, int) or not (0 <= fit_score <= 100):
        raise AgentError(
            f"classify_posting: invalid fit_score {fit_score!r}"
        )
    if not isinstance(rationale, str):
        raise AgentError(
            f"classify_posting: invalid rationale {rationale!r}"
        )

    posting.tier = tier
    posting.fit_score = fit_score
    posting.classification_rationale = rationale[:1000]
    if posting.status == "new":
        posting.status = "classified"
    await db.commit()

    return {"tier": tier, "fit_score": fit_score, "rationale": rationale}
