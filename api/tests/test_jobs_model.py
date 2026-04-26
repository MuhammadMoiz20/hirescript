import pytest
from sqlalchemy import select
from app.models import Job, JobEvent


@pytest.mark.asyncio
async def test_create_job_and_event(db_session):
    job = Job(kind="tailor", status="queued", payload={"resume_id": 1, "jd_id": 2})
    db_session.add(job)
    await db_session.flush()
    assert job.id is not None
    assert job.attempts == 0
    assert job.max_attempts == 1

    ev = JobEvent(job_id=job.id, phase="keywords_start", message=None, data={})
    db_session.add(ev)
    await db_session.flush()
    rows = (await db_session.execute(select(JobEvent).where(JobEvent.job_id == job.id))).scalars().all()
    assert len(rows) == 1
    assert rows[0].phase == "keywords_start"
