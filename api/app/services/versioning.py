from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Resume, ResumeVersion


async def snapshot_resume_version(
    *,
    db: AsyncSession,
    resume: Resume,
    page_count: int,
    edit_source: str,
    edit_prompt: str | None = None,
) -> ResumeVersion:
    """Insert a ResumeVersion row capturing the resume's current latex+content.

    Caller is responsible for the surrounding commit; this function only adds
    and flushes so `version.id` is available.
    """
    version = ResumeVersion(
        resume_id=resume.id,
        latex_source=resume.latex_source,
        content_json=resume.content_json or {},
        page_count=page_count,
        edit_source=edit_source,
        edit_prompt=edit_prompt,
    )
    db.add(version)
    await db.flush()
    return version
