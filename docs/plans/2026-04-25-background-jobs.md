# Background Jobs & Mass-Apply Tailoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Postgres-backed durable job queue and a separate `worker` container so the user can fire off many tailor jobs in parallel, walk away, and watch progress on a Jobs page.

**Architecture:** New `jobs` and `job_events` tables. A `worker` container (same image as `api`, different entrypoint) runs an asyncio supervisor that claims rows with `SELECT ... FOR UPDATE SKIP LOCKED`, executes them with concurrency `WORKER_CONCURRENCY=4`, and writes phase events. The API only enqueues, lists, and streams events via SSE that tails `job_events`. The existing inline tailor SSE endpoint becomes a thin wrapper that enqueues a single-job batch.

**Tech Stack:** FastAPI, async SQLAlchemy 2.x, asyncpg, Alembic, Pydantic v2, React 18, Vite, TypeScript, Vitest + RTL, pytest-asyncio.

**Design doc:** `docs/plans/2026-04-25-background-jobs-design.md` — read this first for context.

---

## Conventions

- All tasks follow TDD: failing test first, minimal implementation, green test, commit.
- Backend tests run via `docker compose run --rm api pytest path -v` (or directly with `pytest` if dev env is set up).
- Frontend tests run via `docker compose run --rm web npm test -- --run path`.
- Commit messages use Conventional Commits (e.g. `feat(api): ...`, `test(web): ...`).
- Never weaken the one-page invariant. The job runner must preserve `page_count` end-to-end exactly like the existing route.

---

## Task 1: `jobs` and `job_events` tables (migration + models)

**Files:**
- Create: `api/alembic/versions/0006_jobs.py`
- Modify: `api/app/models.py` (add `Job`, `JobEvent` ORM models)
- Test: `api/tests/test_jobs_model.py`

**Step 1: Write failing test**

```python
# api/tests/test_jobs_model.py
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
```

**Step 2: Run, verify ImportError / no-such-table**

Run: `docker compose run --rm api pytest api/tests/test_jobs_model.py -v`
Expected: FAIL.

**Step 3: Add models**

```python
# api/app/models.py — append
import uuid
from sqlalchemy import BigInteger, Integer
from sqlalchemy.dialects.postgresql import UUID

class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued", index=True)
    payload: Mapped[dict] = mapped_column(JSONB().with_variant(JSON(), "sqlite"), nullable=False, default=dict)
    result: Mapped[dict | None] = mapped_column(JSONB().with_variant(JSON(), "sqlite"), nullable=True)
    batch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    worker_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class JobEvent(Base):
    __tablename__ = "job_events"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    phase: Mapped[str] = mapped_column(String(64), nullable=False)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    data: Mapped[dict | None] = mapped_column(JSONB().with_variant(JSON(), "sqlite"), nullable=True)
```

**Step 4: Generate migration**

```bash
docker compose run --rm api alembic revision --autogenerate -m "jobs and job_events"
```

Open the generated revision and verify both tables + the `(status, created_at)` and `batch_id` indexes are present. Add a composite index manually if autogenerate misses it:

```python
op.create_index("ix_jobs_status_created_at", "jobs", ["status", "created_at"])
```

**Step 5: Apply and run test**

```bash
docker compose run --rm api alembic upgrade head
docker compose run --rm api pytest api/tests/test_jobs_model.py -v
```

Expected: PASS.

**Step 6: Commit**

```bash
git add api/app/models.py api/alembic/versions/0006_jobs.py api/tests/test_jobs_model.py
git commit -m "feat(api): add jobs and job_events tables"
```

---

## Task 2: Queue repository — `claim_one`, `reclaim_stale`, `emit_event`, `cancel`

**Files:**
- Create: `api/app/services/jobs_repo.py`
- Test: `api/tests/test_jobs_repo.py`

**Step 1: Write failing test for `claim_one` correctness under concurrency**

```python
# api/tests/test_jobs_repo.py
import asyncio, pytest, uuid
from app.models import Job
from app.services.jobs_repo import claim_one, reclaim_stale_jobs, emit_event, cancel_job

@pytest.mark.asyncio
async def test_claim_one_returns_queued_and_marks_running(db_session, sessionmaker_factory):
    job = Job(kind="tailor", payload={}, status="queued")
    db_session.add(job)
    await db_session.commit()

    claimed = await claim_one(sessionmaker_factory, worker_id="w-1")
    assert claimed is not None
    assert claimed.id == job.id
    assert claimed.status == "running"
    assert claimed.worker_id == "w-1"

    again = await claim_one(sessionmaker_factory, worker_id="w-2")
    assert again is None  # already claimed

@pytest.mark.asyncio
async def test_claim_one_concurrent_only_one_wins(sessionmaker_factory):
    async with sessionmaker_factory() as s:
        s.add(Job(kind="tailor", payload={}, status="queued"))
        await s.commit()

    results = await asyncio.gather(*[
        claim_one(sessionmaker_factory, worker_id=f"w-{i}") for i in range(10)
    ])
    winners = [r for r in results if r is not None]
    assert len(winners) == 1

@pytest.mark.asyncio
async def test_reclaim_stale_jobs(sessionmaker_factory, db_session):
    # insert a 'running' job with old heartbeat
    from datetime import datetime, timedelta, timezone
    job = Job(
        kind="tailor", payload={}, status="running", worker_id="dead",
        heartbeat_at=datetime.now(timezone.utc) - timedelta(seconds=120),
    )
    db_session.add(job); await db_session.commit()
    n = await reclaim_stale_jobs(sessionmaker_factory, after_seconds=60)
    assert n == 1
    await db_session.refresh(job)
    assert job.status == "queued"
    assert job.worker_id is None

@pytest.mark.asyncio
async def test_emit_event_appends(sessionmaker_factory, db_session):
    job = Job(kind="tailor", payload={}, status="running")
    db_session.add(job); await db_session.commit()
    await emit_event(sessionmaker_factory, job.id, phase="draft_start", message=None, data={"tier": "sonnet"})
    from app.models import JobEvent
    from sqlalchemy import select
    rows = (await db_session.execute(select(JobEvent).where(JobEvent.job_id == job.id))).scalars().all()
    assert len(rows) == 1 and rows[0].phase == "draft_start"

@pytest.mark.asyncio
async def test_cancel_only_cancels_active(sessionmaker_factory, db_session):
    j1 = Job(kind="tailor", payload={}, status="queued")
    j2 = Job(kind="tailor", payload={}, status="succeeded")
    db_session.add_all([j1, j2]); await db_session.commit()
    assert await cancel_job(sessionmaker_factory, j1.id) is True
    assert await cancel_job(sessionmaker_factory, j2.id) is False
    await db_session.refresh(j1)
    assert j1.status == "cancelled"
```

If `sessionmaker_factory` doesn't exist as a fixture yet, add it to `conftest.py`: a callable returning a fresh `AsyncSession` per call (separate transactions, mandatory for the concurrency test).

**Step 2: Run, verify failures**

Run: `docker compose run --rm api pytest api/tests/test_jobs_repo.py -v`

**Step 3: Implement**

```python
# api/app/services/jobs_repo.py
from __future__ import annotations
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession
from app.models import Job, JobEvent

SessionFactory = Callable[[], AsyncSession]

CLAIM_SQL = text("""
UPDATE jobs SET status='running', worker_id=:wid, started_at=now(), heartbeat_at=now(), attempts=attempts+1
WHERE id = (
    SELECT id FROM jobs WHERE status='queued'
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
)
RETURNING id
""")

async def claim_one(sf: SessionFactory, worker_id: str) -> Job | None:
    async with sf() as s:
        row = (await s.execute(CLAIM_SQL, {"wid": worker_id})).first()
        if row is None:
            await s.commit()
            return None
        job = (await s.execute(select(Job).where(Job.id == row.id))).scalar_one()
        await s.commit()
        return job

async def reclaim_stale_jobs(sf: SessionFactory, after_seconds: int = 60) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=after_seconds)
    async with sf() as s:
        res = await s.execute(
            update(Job)
            .where(Job.status == "running", Job.heartbeat_at < cutoff)
            .values(status="queued", worker_id=None, started_at=None, heartbeat_at=None)
        )
        await s.commit()
        return res.rowcount or 0

async def emit_event(sf: SessionFactory, job_id: uuid.UUID, *, phase: str, message: str | None, data: dict | None) -> None:
    async with sf() as s:
        s.add(JobEvent(job_id=job_id, phase=phase, message=message, data=data))
        await s.commit()

async def cancel_job(sf: SessionFactory, job_id: uuid.UUID) -> bool:
    async with sf() as s:
        res = await s.execute(
            update(Job)
            .where(Job.id == job_id, Job.status.in_(["queued", "running"]))
            .values(status="cancelled", finished_at=datetime.now(timezone.utc))
        )
        await s.commit()
        return (res.rowcount or 0) > 0
```

The SQLite-in-tests case needs a guard: SKIP LOCKED is Postgres-only. If tests use SQLite, add a fallback that does the SELECT then UPDATE inside a transaction with `BEGIN EXCLUSIVE`. Inspect existing `conftest.py` to confirm which DB tests run on. If SQLite-only, swap `CLAIM_SQL` for a Python-level select/update in the SQLite branch.

**Step 4: Run**

Run: `docker compose run --rm api pytest api/tests/test_jobs_repo.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add api/app/services/jobs_repo.py api/tests/test_jobs_repo.py api/tests/conftest.py
git commit -m "feat(api): job queue repo with SKIP LOCKED claim and stale reclaim"
```

---

## Task 3: Tailor job runner

**Files:**
- Create: `api/app/services/jobs_runner.py`
- Test: `api/tests/test_jobs_runner.py`

The runner takes a claimed `Job`, calls `tailor_resume`, persists JD + variant + version (mirroring the logic at `api/app/routes/resumes.py:585-616`), updates `result` and `status`, and emits events.

**Step 1: Write failing test using existing tailor doubles**

```python
# api/tests/test_jobs_runner.py
import pytest, uuid
from app.models import Job, Resume, JobEvent
from sqlalchemy import select
from app.services.jobs_runner import run_tailor_job

@pytest.mark.asyncio
async def test_runs_tailor_and_succeeds(monkeypatch, sessionmaker_factory, seeded_master_resume):
    # seeded_master_resume: a fixture creating a master Resume with latex_source set
    from app.services import jobs_runner
    async def fake_tailor(**kwargs):
        await kwargs["on_progress"]("draft_start", {"tier": "sonnet"})
        from app.services.tailor import TailorResult
        return TailorResult(
            variant_latex="\\documentclass{article}\\begin{document}x\\end{document}",
            pdf=b"%PDF-fake", page_count=1, enforced=True, iterations=1,
            tier_history=["sonnet"], keywords_used=["python"],
        )
    monkeypatch.setattr(jobs_runner, "tailor_resume", fake_tailor)

    async with sessionmaker_factory() as s:
        job = Job(kind="tailor", status="running", worker_id="w-1",
                  payload={"resume_id": seeded_master_resume.id, "jd_text": "JD here",
                           "title": "SWE", "company": "Acme", "url": None, "deep": False})
        s.add(job); await s.commit(); await s.refresh(job)
        jid = job.id

    await run_tailor_job(sessionmaker_factory, jid)

    async with sessionmaker_factory() as s:
        job = (await s.execute(select(Job).where(Job.id == jid))).scalar_one()
        assert job.status == "succeeded"
        assert job.result["page_count"] == 1
        assert "variant_id" in job.result
        evs = (await s.execute(select(JobEvent).where(JobEvent.job_id == jid))).scalars().all()
        assert any(e.phase == "draft_start" for e in evs)
        assert any(e.phase == "done" for e in evs)
```

Add a `seeded_master_resume` fixture if missing: inserts a `User(id=1)` and a master `Resume`.

**Step 2: Run, verify failure**

**Step 3: Implement**

```python
# api/app/services/jobs_runner.py
from __future__ import annotations
import asyncio, uuid
from datetime import datetime, timezone
from sqlalchemy import select, update
from app.models import Job, Resume, JobDescription
from app.services.jobs_repo import emit_event
from app.services.tailor import tailor_resume
from app.services.versioning import snapshot_resume_version

HEARTBEAT_SEC = 10

async def _heartbeat(sf, job_id):
    while True:
        await asyncio.sleep(HEARTBEAT_SEC)
        async with sf() as s:
            await s.execute(update(Job).where(Job.id == job_id).values(heartbeat_at=datetime.now(timezone.utc)))
            await s.commit()

async def _is_cancelled(sf, job_id) -> bool:
    async with sf() as s:
        st = (await s.execute(select(Job.status).where(Job.id == job_id))).scalar_one()
        return st == "cancelled"

async def run_tailor_job(sf, job_id: uuid.UUID) -> None:
    hb = asyncio.create_task(_heartbeat(sf, job_id))
    try:
        async with sf() as s:
            job = (await s.execute(select(Job).where(Job.id == job_id))).scalar_one()
            payload = job.payload
            master = (await s.execute(select(Resume).where(Resume.id == payload["resume_id"]))).scalar_one()
            master_latex = master.latex_source
            master_protected = list(master.protected_terms or [])
            master_id = master.id; master_name = master.name; master_template_id = master.template_id

        async def on_progress(event: str, data: dict) -> None:
            await emit_event(sf, job_id, phase=event, message=None, data=data)
            if await _is_cancelled(sf, job_id):
                raise asyncio.CancelledError()

        result = await tailor_resume(
            master_latex=master_latex,
            jd_text=payload["jd_text"],
            user_pinned=master_protected,
            deep_tailor=bool(payload.get("deep")),
            on_progress=on_progress,
        )

        async with sf() as s:
            jd = JobDescription(
                user_id=1, title=payload["title"], company=payload["company"],
                url=payload.get("url"), raw_text=payload["jd_text"],
                parsed_json={"keywords": result.keywords_used},
            )
            s.add(jd); await s.flush()
            variant = Resume(
                user_id=1, parent_id=master_id, kind="variant",
                name=f"{master_name} \u2014 {payload['company']}",
                template_id=master_template_id, latex_source=result.variant_latex,
                job_description_id=jd.id, protected_terms=master_protected,
            )
            s.add(variant); await s.flush()
            await snapshot_resume_version(
                db=s, resume=variant, page_count=result.page_count,
                edit_source="ai_tailor", edit_prompt=f"{payload['title']} @ {payload['company']}",
                pdf_bytes=result.pdf,
            )
            await s.execute(update(Job).where(Job.id == job_id).values(
                status="succeeded", finished_at=datetime.now(timezone.utc),
                result={"variant_id": variant.id, "jd_id": jd.id, "page_count": result.page_count,
                        "iterations": result.iterations, "enforced": result.enforced,
                        "tier_history": result.tier_history, "keywords_used": result.keywords_used},
            ))
            await s.commit()
        await emit_event(sf, job_id, phase="done", message=None, data={})

    except asyncio.CancelledError:
        async with sf() as s:
            await s.execute(update(Job).where(Job.id == job_id, Job.status != "cancelled").values(
                status="cancelled", finished_at=datetime.now(timezone.utc)))
            await s.commit()
        await emit_event(sf, job_id, phase="cancelled", message=None, data={})
    except Exception as exc:
        async with sf() as s:
            await s.execute(update(Job).where(Job.id == job_id).values(
                status="failed", finished_at=datetime.now(timezone.utc),
                result={"error": str(exc)[:500]}))
            await s.commit()
        await emit_event(sf, job_id, phase="failed", message=str(exc)[:500], data={})
    finally:
        hb.cancel()
```

**Step 4: Run**

`docker compose run --rm api pytest api/tests/test_jobs_runner.py -v` — PASS.

**Step 5: Commit**

```bash
git add api/app/services/jobs_runner.py api/tests/test_jobs_runner.py
git commit -m "feat(api): tailor job runner with progress events and cancellation"
```

---

## Task 4: Worker entrypoint

**Files:**
- Create: `api/app/worker.py`
- Test: `api/tests/test_worker.py`

**Step 1: Write failing test**

```python
# api/tests/test_worker.py
import asyncio, pytest, uuid
from app.models import Job
from sqlalchemy import select

@pytest.mark.asyncio
async def test_worker_drains_one_job(monkeypatch, sessionmaker_factory, seeded_master_resume):
    from app.services import jobs_runner
    calls = []
    async def fake_run(sf, jid):
        calls.append(jid)
        async with sf() as s:
            from sqlalchemy import update
            await s.execute(update(Job).where(Job.id == jid).values(status="succeeded"))
            await s.commit()
    monkeypatch.setattr(jobs_runner, "run_tailor_job", fake_run)

    async with sessionmaker_factory() as s:
        job = Job(kind="tailor", status="queued",
                  payload={"resume_id": seeded_master_resume.id, "jd_text": "x",
                           "title": "t", "company": "c", "url": None, "deep": False})
        s.add(job); await s.commit(); await s.refresh(job); jid = job.id

    from app.worker import run_until_idle
    await run_until_idle(sessionmaker_factory, worker_id="w-test", concurrency=2, max_idle_polls=2)
    assert jid in calls
```

`run_until_idle` is a test-friendly variant of the supervisor that exits after `max_idle_polls` consecutive empty polls.

**Step 2: Run — fail.**

**Step 3: Implement**

```python
# api/app/worker.py
from __future__ import annotations
import asyncio, logging, os, signal, uuid
from app.db import SessionLocal
from app.services.jobs_repo import claim_one, reclaim_stale_jobs
from app.services import jobs_runner

log = logging.getLogger("worker")
POLL_SEC = 1.0

async def _dispatch(sf, job, sem):
    try:
        if job.kind == "tailor":
            await jobs_runner.run_tailor_job(sf, job.id)
        else:
            log.warning("unknown job kind: %s", job.kind)
    finally:
        sem.release()

async def run_until_idle(sf, *, worker_id: str, concurrency: int, max_idle_polls: int) -> None:
    sem = asyncio.Semaphore(concurrency)
    idle = 0
    inflight: set[asyncio.Task] = set()
    while idle < max_idle_polls:
        await sem.acquire()
        job = await claim_one(sf, worker_id=worker_id)
        if job is None:
            sem.release()
            idle += 1
            await asyncio.sleep(POLL_SEC)
            continue
        idle = 0
        t = asyncio.create_task(_dispatch(sf, job, sem))
        inflight.add(t); t.add_done_callback(inflight.discard)
    if inflight:
        await asyncio.gather(*inflight, return_exceptions=True)

async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    worker_id = f"worker-{uuid.uuid4()}"
    concurrency = int(os.environ.get("WORKER_CONCURRENCY", "4"))
    log.info("worker %s starting concurrency=%d", worker_id, concurrency)
    await reclaim_stale_jobs(SessionLocal, after_seconds=60)
    shutdown = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, shutdown.set)

    sem = asyncio.Semaphore(concurrency)
    inflight: set[asyncio.Task] = set()
    while not shutdown.is_set():
        await sem.acquire()
        job = await claim_one(SessionLocal, worker_id=worker_id)
        if job is None:
            sem.release()
            try:
                await asyncio.wait_for(shutdown.wait(), timeout=POLL_SEC)
            except asyncio.TimeoutError:
                pass
            continue
        async def _wrap(j):
            try: await jobs_runner.run_tailor_job(SessionLocal, j.id)
            finally: sem.release()
        t = asyncio.create_task(_wrap(job))
        inflight.add(t); t.add_done_callback(inflight.discard)

    log.info("worker draining %d jobs", len(inflight))
    if inflight: await asyncio.gather(*inflight, return_exceptions=True)

if __name__ == "__main__":
    asyncio.run(main())
```

**Step 4: Run — PASS.**

**Step 5: Commit**

```bash
git add api/app/worker.py api/tests/test_worker.py
git commit -m "feat(api): worker supervisor with concurrency and graceful shutdown"
```

---

## Task 5: `POST /api/jobs/tailor` (batch enqueue)

**Files:**
- Create: `api/app/routes/jobs.py`
- Modify: `api/app/main.py` (register router)
- Modify: `api/app/schemas.py` (add `JobOut`, `JobListOut`, `EnqueueTailorIn`, `EnqueueTailorOut`)
- Test: `api/tests/test_jobs_routes.py`

**Step 1: Write failing test**

```python
# api/tests/test_jobs_routes.py
import pytest

@pytest.mark.asyncio
async def test_enqueue_tailor_batch_creates_n_jobs(client_authed, seeded_master_resume):
    body = {
        "resume_id": seeded_master_resume.id,
        "items": [
            {"jd_text": "JD A", "title": "SWE", "company": "Acme"},
            {"jd_text": "JD B", "title": "SWE II", "company": "Beta"},
        ],
        "deep": False,
    }
    r = await client_authed.post("/api/jobs/tailor", json=body)
    assert r.status_code == 200
    data = r.json()
    assert "batch_id" in data and len(data["job_ids"]) == 2
```

**Step 2: Run — fail.**

**Step 3: Implement schemas + route**

```python
# api/app/schemas.py — append
class TailorItem(BaseModel):
    jd_text: str
    title: str
    company: str
    url: str | None = None

class EnqueueTailorIn(BaseModel):
    resume_id: int
    items: list[TailorItem]
    deep: bool = False

class EnqueueTailorOut(BaseModel):
    batch_id: uuid.UUID
    job_ids: list[uuid.UUID]
```

```python
# api/app/routes/jobs.py
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.deps import get_db, require_auth
from app.models import Job
from app.schemas import EnqueueTailorIn, EnqueueTailorOut

router = APIRouter(prefix="/api/jobs", tags=["jobs"])

@router.post("/tailor", response_model=EnqueueTailorOut)
async def enqueue_tailor(body: EnqueueTailorIn, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    if not body.items:
        raise HTTPException(400, "items required")
    batch_id = uuid.uuid4()
    jobs = []
    for item in body.items:
        j = Job(kind="tailor", status="queued", batch_id=batch_id, payload={
            "resume_id": body.resume_id,
            "jd_text": item.jd_text, "title": item.title, "company": item.company,
            "url": item.url, "deep": body.deep,
        })
        db.add(j); jobs.append(j)
    await db.commit()
    return EnqueueTailorOut(batch_id=batch_id, job_ids=[j.id for j in jobs])
```

Register in `main.py`:

```python
from app.routes import auth, resumes, versions, jds, jobs
app.include_router(jobs.router)
```

**Step 4: Run — PASS.**

**Step 5: Commit**

```bash
git add api/app/routes/jobs.py api/app/main.py api/app/schemas.py api/tests/test_jobs_routes.py
git commit -m "feat(api): POST /api/jobs/tailor batch enqueue"
```

---

## Task 6: `GET /api/jobs` and `GET /api/jobs/{id}`

**Files:**
- Modify: `api/app/routes/jobs.py`, `api/app/schemas.py`
- Modify: `api/tests/test_jobs_routes.py`

**Step 1: Write failing tests**

```python
@pytest.mark.asyncio
async def test_list_jobs_filters_by_status_and_batch(client_authed, db_session):
    from app.models import Job
    import uuid
    bid = uuid.uuid4()
    db_session.add_all([
        Job(kind="tailor", status="queued", batch_id=bid, payload={}),
        Job(kind="tailor", status="succeeded", batch_id=bid, payload={}),
        Job(kind="tailor", status="queued", payload={}),
    ])
    await db_session.commit()
    r = await client_authed.get("/api/jobs", params={"status": "queued"})
    assert r.status_code == 200
    assert len(r.json()["items"]) == 2
    r = await client_authed.get("/api/jobs", params={"batch_id": str(bid)})
    assert len(r.json()["items"]) == 2

@pytest.mark.asyncio
async def test_get_job_detail(client_authed, db_session):
    from app.models import Job
    j = Job(kind="tailor", status="queued", payload={"resume_id": 1})
    db_session.add(j); await db_session.commit()
    r = await client_authed.get(f"/api/jobs/{j.id}")
    assert r.status_code == 200 and r.json()["status"] == "queued"
```

**Step 2: Run — fail.**

**Step 3: Implement**

```python
class JobOut(BaseModel):
    id: uuid.UUID
    kind: str
    status: str
    batch_id: uuid.UUID | None
    payload: dict
    result: dict | None
    attempts: int
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    model_config = ConfigDict(from_attributes=True)

class JobListOut(BaseModel):
    items: list[JobOut]
    total: int
```

```python
@router.get("", response_model=JobListOut)
async def list_jobs(
    status: str | None = None, batch_id: uuid.UUID | None = None,
    limit: int = 50, offset: int = 0,
    db: AsyncSession = Depends(get_db), _=Depends(require_auth),
):
    stmt = select(Job).order_by(Job.created_at.desc())
    if status:
        stmt = stmt.where(Job.status.in_(status.split(",")))
    if batch_id:
        stmt = stmt.where(Job.batch_id == batch_id)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(stmt.limit(limit).offset(offset))).scalars().all()
    return JobListOut(items=[JobOut.model_validate(r) for r in rows], total=total)

@router.get("/{job_id}", response_model=JobOut)
async def get_job(job_id: uuid.UUID, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    job = (await db.execute(select(Job).where(Job.id == job_id))).scalar_one_or_none()
    if not job: raise HTTPException(404)
    return JobOut.model_validate(job)
```

**Step 4: Run — PASS.**

**Step 5: Commit**

```bash
git commit -am "feat(api): list and get job endpoints"
```

---

## Task 7: SSE `GET /api/jobs/{id}/events`

**Files:**
- Modify: `api/app/routes/jobs.py`
- Modify: `api/tests/test_jobs_routes.py`

**Step 1: Write failing test**

```python
@pytest.mark.asyncio
async def test_events_stream_terminates_on_done(client_authed, db_session):
    from app.models import Job, JobEvent
    j = Job(kind="tailor", status="succeeded", payload={}, result={"page_count": 1})
    db_session.add(j); await db_session.flush()
    db_session.add_all([
        JobEvent(job_id=j.id, phase="draft_start", data={}),
        JobEvent(job_id=j.id, phase="done", data={}),
    ])
    await db_session.commit()
    async with client_authed.stream("GET", f"/api/jobs/{j.id}/events") as r:
        chunks = []
        async for line in r.aiter_lines():
            chunks.append(line)
            if "event: done" in line:
                break
    body = "\n".join(chunks)
    assert "event: phase" in body and "draft_start" in body
    assert "event: done" in body
```

**Step 2: Run — fail.**

**Step 3: Implement**

```python
import asyncio, json
from fastapi.responses import StreamingResponse
from app.models import JobEvent

@router.get("/{job_id}/events")
async def stream_events(job_id: uuid.UUID, cursor: int = 0, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    async def gen():
        last = cursor
        terminal = False
        while not terminal:
            rows = (await db.execute(
                select(JobEvent).where(JobEvent.job_id == job_id, JobEvent.id > last).order_by(JobEvent.id)
            )).scalars().all()
            for ev in rows:
                last = ev.id
                if ev.phase in ("done", "failed", "cancelled"):
                    yield f"event: {ev.phase}\ndata: {json.dumps(ev.data or {})}\n\n"
                    terminal = True
                else:
                    yield f"event: phase\ndata: {json.dumps({'phase': ev.phase, 'message': ev.message, 'data': ev.data})}\n\n"
            if terminal: break
            await asyncio.sleep(0.5)
    return StreamingResponse(gen(), media_type="text/event-stream")
```

Note: this test reads only what's already in the table (terminal `done` already inserted) so it shouldn't hang. For runtime, the 500ms poll keeps SSE simple.

**Step 4: Run — PASS.**

**Step 5: Commit**

```bash
git commit -am "feat(api): SSE job events stream"
```

---

## Task 8: `POST /api/jobs/{id}/cancel`

**Files:**
- Modify: `api/app/routes/jobs.py`, `api/tests/test_jobs_routes.py`

**Step 1: Test**

```python
@pytest.mark.asyncio
async def test_cancel_queued_job(client_authed, db_session):
    from app.models import Job
    j = Job(kind="tailor", status="queued", payload={})
    db_session.add(j); await db_session.commit()
    r = await client_authed.post(f"/api/jobs/{j.id}/cancel")
    assert r.status_code == 200
    await db_session.refresh(j)
    assert j.status == "cancelled"
```

**Step 2: Fail. Step 3: Implement.**

```python
from app.services.jobs_repo import cancel_job
from app.db import SessionLocal

@router.post("/{job_id}/cancel")
async def cancel(job_id: uuid.UUID, _=Depends(require_auth)):
    ok = await cancel_job(SessionLocal, job_id)
    if not ok: raise HTTPException(409, "not cancellable")
    return {"ok": True}
```

**Step 4: PASS. Step 5: Commit.**

```bash
git commit -am "feat(api): cancel job endpoint"
```

---

## Task 9: Migrate `POST /resumes/{id}/tailor` to enqueue + delegate to job SSE

**Files:**
- Modify: `api/app/routes/resumes.py:480-650` (the existing tailor route — replace inline runner with enqueue + redirect to job events)
- Modify: `api/tests/test_resumes.py` (existing tailor SSE tests need to still pass)

**Approach:** the route now (a) creates a single-job batch via the same code path as `/api/jobs/tailor`, (b) starts the worker dispatch in-process **only if no separate worker container is running** — for production, the worker container handles it. For tests, the simplest move is to inline-execute the job synchronously when an env flag `JOBS_INLINE=1` is set; the existing test fixtures set this.

**Step 1: Update existing tests to set `JOBS_INLINE=1` (or test the new shape directly)**

```python
# api/tests/conftest.py — add fixture autouse
@pytest.fixture(autouse=True)
def jobs_inline(monkeypatch):
    monkeypatch.setenv("JOBS_INLINE", "1")
```

**Step 2: Implement the rewrite**

Replace the body of the existing tailor SSE route:

```python
# api/app/routes/resumes.py
import os
@router.post("/{resume_id}/tailor")
async def tailor_resume_route(resume_id: int, body: TailorRequest, ...):
    # build payload, create Job row, commit
    job = Job(kind="tailor", status="queued", payload={
        "resume_id": resume_id, "jd_text": body.jd_text,
        "title": body.title, "company": body.company, "url": body.url,
        "deep": body.deep_tailor,
    })
    db.add(job); await db.commit(); await db.refresh(job)

    if os.environ.get("JOBS_INLINE") == "1":
        from app.services.jobs_runner import run_tailor_job
        from app.db import SessionLocal
        # claim then run synchronously so events stream
        await db.execute(update(Job).where(Job.id == job.id).values(
            status="running", worker_id="inline", started_at=func.now()))
        await db.commit()
        await run_tailor_job(SessionLocal, job.id)

    # delegate to job event stream
    return RedirectResponse(url=f"/api/jobs/{job.id}/events", status_code=307)
```

(Or skip the redirect and just return `{"job_id": job.id}` — pick whichever requires the smallest frontend change. The frontend modal currently consumes SSE directly; updating it in Task 15 is easier than handling redirects in EventSource.)

**Step 3: Run existing tailor tests; adjust assertions to read job rows / job events instead of inline `result`/`error` SSE events.**

`docker compose run --rm api pytest api/tests/test_resumes.py -v`

**Step 4: Commit**

```bash
git commit -am "refactor(api): route /resumes/{id}/tailor through job queue"
```

---

## Task 10: `worker` service in docker-compose

**Files:**
- Modify: `docker-compose.yml`

**Step 1: Add a worker service mirroring api.**

```yaml
worker:
  build: ./api
  command: ["python", "-m", "app.worker"]
  env_file: .env
  environment:
    - WORKER_CONCURRENCY=4
  depends_on:
    - db
  volumes:
    - ./api:/app
```

**Step 2: Verify it boots**

```bash
docker compose up -d --build worker
docker compose logs worker --tail=20
```

Expected: `worker worker-<uuid> starting concurrency=4`.

**Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(infra): add worker service to docker-compose"
```

---

## Task 11: Frontend API client functions

**Files:**
- Modify: `web/src/api.ts`

**Step 1: Add types and functions**

```ts
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface Job {
  id: string;
  kind: string;
  status: JobStatus;
  batch_id: string | null;
  payload: any;
  result: any | null;
  attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface TailorItem { jd_text: string; title: string; company: string; url?: string; }

export async function enqueueTailorBatch(body: { resume_id: number; items: TailorItem[]; deep?: boolean }): Promise<{ batch_id: string; job_ids: string[] }> {
  const r = await fetch("/api/jobs/tailor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`enqueueTailorBatch ${r.status}`);
  return r.json();
}

export async function listJobs(params: { status?: string; batch_id?: string; limit?: number; offset?: number } = {}): Promise<{ items: Job[]; total: number }> {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
  const r = await fetch(`/api/jobs?${qs}`);
  if (!r.ok) throw new Error(`listJobs ${r.status}`);
  return r.json();
}

export async function cancelJob(id: string): Promise<void> {
  const r = await fetch(`/api/jobs/${id}/cancel`, { method: "POST" });
  if (!r.ok) throw new Error(`cancelJob ${r.status}`);
}
```

**Step 2: No new tests yet (consumed by components below).**

**Step 3: Commit**

```bash
git commit -am "feat(web): jobs API client functions"
```

---

## Task 12: Topbar jobs badge component

**Files:**
- Create: `web/src/components/JobsBadge.tsx`
- Create: `web/src/components/JobsBadge.test.tsx`
- Modify: wherever the topbar lives (likely `web/src/App.tsx` or a layout component — grep for the existing nav)

**Step 1: Test**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { JobsBadge } from "./JobsBadge";
import { vi } from "vitest";

vi.mock("../api", () => ({
  listJobs: vi.fn().mockResolvedValue({ items: [], total: 3 }),
}));

test("shows count when > 0", async () => {
  render(<JobsBadge />);
  await waitFor(() => expect(screen.getByText("3")).toBeInTheDocument());
});

test("hidden at 0", async () => {
  const { listJobs } = await import("../api");
  (listJobs as any).mockResolvedValue({ items: [], total: 0 });
  render(<JobsBadge />);
  await waitFor(() => expect(screen.queryByTestId("jobs-badge")).toBeNull());
});
```

**Step 2: Fail. Step 3: Implement**

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listJobs } from "../api";

export function JobsBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const { total } = await listJobs({ status: "queued,running" });
        if (!cancelled) setCount(total);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  if (count === 0) return null;
  return <Link to="/jobs" data-testid="jobs-badge" className="badge">{count}</Link>;
}
```

**Step 4: PASS. Step 5: Commit.**

```bash
git commit -am "feat(web): topbar jobs badge"
```

---

## Task 13: `/jobs` route — Jobs page with batch grouping

**Files:**
- Create: `web/src/routes/Jobs.tsx`
- Create: `web/src/routes/Jobs.test.tsx`
- Modify: router config (likely `App.tsx`) to register `/jobs`

**Step 1: Test (table renders, retry button on failed, cancel on running)**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { Jobs } from "./Jobs";
import { vi } from "vitest";

vi.mock("../api", () => ({
  listJobs: vi.fn().mockResolvedValue({
    items: [
      { id: "a", status: "running", batch_id: "b1", payload: { title: "SWE", company: "Acme" }, result: null, created_at: "2026-04-25T00:00:00Z" },
      { id: "b", status: "failed", batch_id: "b1", payload: { title: "SWE", company: "Beta" }, result: { error: "boom" }, created_at: "2026-04-25T00:00:00Z" },
    ],
    total: 2,
  }),
  cancelJob: vi.fn(),
}));

test("renders jobs grouped by batch", async () => {
  render(<Jobs />);
  await waitFor(() => screen.getByText("Acme"));
  expect(screen.getByText("Beta")).toBeInTheDocument();
  expect(screen.getByText(/boom/)).toBeInTheDocument();
});
```

**Step 2: Fail. Step 3: Implement** with a polling `useEffect` (every 2s while any job is `running` or `queued`).

**Step 4: PASS. Step 5: Commit.**

```bash
git commit -am "feat(web): jobs page with batch grouping and live polling"
```

---

## Task 14: JD list multi-select + mass-apply action

**Files:**
- Modify: `web/src/routes/` — find/create JD list page (currently `api/app/routes/jds.py` exists; check for a `Jds.tsx` route, create if missing)
- Possibly: `web/src/components/MassApplyDialog.tsx`

**Step 1: Test**

```tsx
test("submitting multi-select enqueues batch and navigates", async () => {
  // mock enqueueTailorBatch + useNavigate
  // simulate selecting 2 JDs, picking master resume, clicking Tailor
  // assert enqueueTailorBatch called with 2 items, navigate("/jobs?batch=...")
});
```

**Step 2-4: Implement.** Component holds `selectedIds: Set<number>`; opens a dialog with a resume picker (master only) and Deep toggle; on submit calls `enqueueTailorBatch` and navigates.

**Step 5: Commit.**

```bash
git commit -am "feat(web): mass-apply tailoring from JD list"
```

---

## Task 15: Tailor modal SSE source switch

**Files:**
- Modify: `web/src/components/` — wherever the existing tailor modal lives (grep for the existing SSE-consuming component)

**Step 1: Update existing test** to mock the new flow: the modal first POSTs to `/api/resumes/{id}/tailor` (or directly to `/api/jobs/tailor` with a single item) and then opens an `EventSource` on `/api/jobs/{job_id}/events`.

**Step 2-4: Implement.** Replace the SSE URL. Phase event names already match (`draft_start`, `enforce_iteration`, etc. — keep them identical between the runner and the modal so no UI change is needed). Terminal events: handle both `done` (load result via `GET /api/jobs/{id}` to read `result`) and `failed` / `cancelled`.

**Step 5: Commit.**

```bash
git commit -am "refactor(web): tailor modal subscribes to job events SSE"
```

---

## Final verification

```bash
docker compose run --rm api pytest -v
docker compose run --rm web npm test -- --run
docker compose up --build
```

Smoke test:
1. Log in.
2. Open `/jds`, multi-select 3 JDs, mass-apply against the master resume.
3. Confirm `/jobs` shows 3 queued → running (4-wide concurrency means all 3 start) → succeeded.
4. Confirm topbar badge appears with count, drops to 0 when done.
5. Open one resulting variant; confirm `page_count == 1`.
6. Restart `worker` mid-batch (`docker compose restart worker`); confirm in-flight jobs reclaim and re-run.

Commit anything pending and open a PR.

---

## Notes for the executor

- **Cancellation propagation** in `_is_cancelled` polls Postgres on every progress event — that's chatty but cheap. Don't optimize prematurely.
- **SSE polling at 500ms** is fine for single-tenant. If it ever feels laggy, swap in `LISTEN/NOTIFY` on a `job_events_inserted` channel — out of scope here.
- **`JOBS_INLINE=1`** is a test-only switch; do not document it as a deploy mode. Production always uses the worker container.
- **Don't add scheduler/cron primitives**, retry/backoff for arbitrary kinds, or auth scoping. Single-tenant; expand only when a real second use case appears.
