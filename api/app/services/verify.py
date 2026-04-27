"""Haiku-backed claim-grounding verifier.

Reads the tailored resume LaTeX + cover letter for an :class:`Application`,
plus the user's :class:`Profile` and the top-12 KB chunks for the posting's
description, and asks Haiku whether every concrete claim in the materials is
supported by that evidence.

The verifier is a JUDGE — it never edits resume LaTeX or cover letter text.
Its output (:class:`VerifyResult`) is consumed by the runner, which writes
it onto the Application row. Submit (Batch C) decides whether to gate on it.
"""

from __future__ import annotations

import json
import logging
from typing import Any, TypedDict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Application,
    JobPosting,
    Profile as ProfileModel,
    Resume,
)
from app.services import claude_router, kb_ingest
from app.services.agent import AgentError
from app.services.claude_router import get_api_client


log = logging.getLogger(__name__)


_SYSTEM_PROMPT = (
    "You verify that every concrete claim in the candidate's tailored "
    "materials (resume + cover letter) is supported by the profile or "
    "the KB notes provided. Concrete claims = job titles, employers, "
    "dates, metrics, technologies, education. List any claim that "
    "cannot be grounded. Output strict JSON: "
    "{\"ok\": bool, \"issues\": [..], \"rationale\": \"..\"}."
)


class VerifyResult(TypedDict):
    ok: bool
    issues: list[str]
    rationale: str


def _format_kb_chunks(chunks: list[dict[str, Any]]) -> str:
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


def _extract_text(message_obj: Any) -> str:
    """Pull the concatenated text from an Anthropic ``messages.create`` response."""
    blocks = getattr(message_obj, "content", None) or []
    parts: list[str] = []
    for b in blocks:
        # The Anthropic SDK exposes blocks with ``.type`` and ``.text``.
        text = getattr(b, "text", None)
        if isinstance(text, str):
            parts.append(text)
    return "".join(parts)


async def verify_application(
    db: AsyncSession, *, application_id: int
) -> VerifyResult:
    """Judge whether ``application_id``'s tailored materials are grounded.

    Returns the parsed JSON verdict. Raises :class:`AgentError` on a
    malformed model response (missing keys, non-JSON output, wrong types).
    """
    app = (
        await db.execute(
            select(Application).where(Application.id == application_id)
        )
    ).scalar_one()

    posting = (
        await db.execute(
            select(JobPosting).where(JobPosting.id == app.posting_id)
        )
    ).scalar_one()

    resume_latex = ""
    if app.resume_variant_id is not None:
        variant = (
            await db.execute(
                select(Resume).where(Resume.id == app.resume_variant_id)
            )
        ).scalar_one_or_none()
        if variant is not None:
            resume_latex = variant.latex_source or ""

    profile_row = (
        await db.execute(
            select(ProfileModel).where(ProfileModel.user_id == app.user_id)
        )
    ).scalar_one_or_none()
    profile_data = profile_row.data if profile_row is not None else {}

    chunks = await kb_ingest.retrieve(
        db,
        user_id=app.user_id,
        query=posting.description_text or posting.title,
        k=12,
    )

    user_prompt = (
        f"Profile (JSON):\n{json.dumps(profile_data, ensure_ascii=False)}\n\n"
        f"KB notes:\n{_format_kb_chunks(list(chunks))}\n\n"
        f"Resume LaTeX:\n```latex\n{resume_latex}\n```\n\n"
        f"Cover letter:\n{app.cover_letter_text or '(none)'}\n"
    )

    choice = await claude_router.choose(db, task_kind="verify")
    client = get_api_client()
    response = await client.messages.create(
        model=choice["model"],
        max_tokens=1024,
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    usage = getattr(response, "usage", None)
    input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
    output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
    await claude_router.record_usage(
        db,
        client=choice["client"],
        model=choice["model"],
        task_kind="verify",
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )

    raw = _extract_text(response).strip()
    if not raw:
        raise AgentError("verify_application: model returned no text")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise AgentError(
            f"verify_application: invalid JSON: {exc}; got {raw[:200]}"
        ) from exc
    if not isinstance(parsed, dict):
        raise AgentError("verify_application: response must be a JSON object")
    ok = parsed.get("ok")
    issues = parsed.get("issues")
    rationale = parsed.get("rationale")
    if not isinstance(ok, bool):
        raise AgentError(f"verify_application: missing/invalid `ok`: {ok!r}")
    if not isinstance(issues, list) or not all(
        isinstance(i, str) for i in issues
    ):
        raise AgentError(
            f"verify_application: `issues` must be list[str]: {issues!r}"
        )
    if not isinstance(rationale, str):
        raise AgentError(
            f"verify_application: `rationale` must be str: {rationale!r}"
        )
    return VerifyResult(ok=ok, issues=list(issues), rationale=rationale)


__all__ = ["VerifyResult", "verify_application"]
