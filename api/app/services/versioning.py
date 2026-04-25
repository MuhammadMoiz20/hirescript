from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Resume, ResumeVersion
from app.services.storage import put_pdf


async def snapshot_resume_version(
    *,
    db: AsyncSession,
    resume: Resume,
    page_count: int,
    edit_source: str,
    edit_prompt: str | None = None,
    pdf_bytes: bytes | None = None,
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
    if pdf_bytes:
        try:
            key = f"versions/{version.id}.pdf"
            put_pdf(key=key, data=pdf_bytes)
            version.compiled_pdf_key = key
            await db.flush()
        except Exception as e:
            # Don't fail the snapshot if storage is unavailable; log and proceed.
            import logging
            logging.getLogger(__name__).warning("storage put_pdf failed: %s", e)
    return version
