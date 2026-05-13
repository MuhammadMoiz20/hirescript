"""KB-aware tailor wrapper.

Augments :func:`app.services.tailor.tailor_resume` with the user's KB
chunks for grounding. Persists the resulting variant + version snapshot
the same way the inline tailor route does, then returns a compact result
the orchestrator (Task 12) can hand back to the API.
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable, TypedDict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import JobDescription, JobPosting, Resume
from app.services import kb_ingest, tailor as tailor_module
from app.services.tailor import tailor_resume
from app.services.versioning import snapshot_resume_version


class TailorForAppResult(TypedDict):
    variant_id: int
    page_count: int
    iterations: int
    enforced: bool
    kb_chunks_used: int


def _format_kb_chunks(chunks: list[dict[str, Any]]) -> str:
    """Render retrieved KB chunks as a system-prompt addendum."""
    if not chunks:
        return ""
    lines = [
        "USER KNOWLEDGE BASE (use these to ground specific claims; do NOT invent):"
    ]
    for i, c in enumerate(chunks, start=1):
        source = c.get("source", "unknown")
        title = c.get("title", "untitled")
        text = (c.get("text") or "").strip()
        lines.append(f"--- chunk {i} (source={source}, title={title}) ---")
        lines.append(text)
    return "\n".join(lines)


async def tailor_for_application(
    db: AsyncSession,
    *,
    user_id: int,
    posting_id: int,
    on_progress: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None,
) -> TailorForAppResult:
    """Tailor the master resume for ``posting_id`` augmented with KB chunks.

    Loads the master :class:`Resume` (parent_id is null, ``user_id`` match)
    and the posting, retrieves the top-8 KB chunks for the posting's
    description, then calls :func:`tailor_resume` with the chunks rendered
    into ``system_prompt_addendum``.

    Persists a ``JobDescription`` + variant ``Resume`` + ``ResumeVersion``
    snapshot mirroring the inline tailor route.
    """
    posting = (
        await db.execute(
            select(JobPosting).where(JobPosting.id == posting_id)
        )
    ).scalar_one()

    master = (
        await db.execute(
            select(Resume).where(
                Resume.user_id == user_id,
                Resume.parent_id.is_(None),
                Resume.kind == "master",
            )
        )
    ).scalar_one()

    chunks = await kb_ingest.retrieve(
        db,
        user_id=user_id,
        query=posting.description_text or posting.title,
        k=8,
    )
    addendum = _format_kb_chunks(list(chunks))

    # TODO(slice-2-task-12): idempotency. If called twice for the same
    # posting_id, this currently creates two JobDescription + variant Resume
    # + ResumeVersion rows. The Task 12 orchestrator must guarantee
    # at-most-once invocation per posting (e.g. by checking
    # applications.posting_id before tailoring) until we add a unique
    # constraint or a "find-or-create variant" guard here.
    result = await tailor_resume(
        master_latex=master.latex_source,
        jd_text=posting.description_text or "",
        user_pinned=list(master.protected_terms or []),
        deep_tailor=False,
        on_progress=on_progress,
        system_prompt_addendum=addendum or None,
        db=db,
        tier_slug=posting.tier,
        one_line_per_bullet=master.one_line_per_bullet,
    )

    # Persist JD + variant + version snapshot. Mirrors run_tailor_job.
    company_name = "(unknown)"
    if posting.company_id is not None:
        from app.models import Company

        company_row = (
            await db.execute(
                select(Company).where(Company.id == posting.company_id)
            )
        ).scalar_one_or_none()
        if company_row is not None:
            company_name = company_row.display_name

    jd = JobDescription(
        user_id=user_id,
        title=posting.title,
        company=company_name,
        url=posting.apply_url,
        raw_text=posting.description_text or "",
        parsed_json={"keywords": result.keywords_used},
    )
    db.add(jd)
    await db.flush()

    variant = Resume(
        user_id=user_id,
        parent_id=master.id,
        kind="variant",
        name=f"{master.name} — {company_name}",
        template_id=master.template_id,
        latex_source=result.variant_latex,
        job_description_id=jd.id,
        protected_terms=list(master.protected_terms or []),
        one_line_per_bullet=master.one_line_per_bullet,
    )
    db.add(variant)
    await db.flush()

    await snapshot_resume_version(
        db=db,
        resume=variant,
        page_count=result.page_count,
        edit_source="ai_tailor",
        edit_prompt=f"{posting.title} @ {company_name}",
        pdf_bytes=result.pdf,
    )
    await db.commit()

    return TailorForAppResult(
        variant_id=variant.id,
        page_count=result.page_count,
        iterations=result.iterations,
        enforced=result.enforced,
        kb_chunks_used=len(chunks),
    )


# Re-export for tests that want to monkeypatch the call site.
__all__ = ["tailor_for_application", "TailorForAppResult", "tailor_module"]
