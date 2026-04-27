"""Background worker supervisor.

Maintains up to ``WORKER_CONCURRENCY`` in-flight jobs by polling the queue
with ``claim_one`` and dispatching to the appropriate runner. Single-tenant:
no per-tenant accounting, just a flat semaphore bound on concurrency.
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Application, Company, Job, JobPosting, Tier
from app.services import jobs_runner
from app.services.jobs_repo import (
    claim_one,
    count_submitted_today_for_tier,
    enqueue_ingest_greenhouse,
    enqueue_submit_application,
    reclaim_stale_jobs,
)

# NOTE: companies are seeded by Alembic migration 0012 — the boot-time
# reconciliation that lived here was removed in slice 4 Batch A so the DB
# is the single source of truth for the allowlist.

log = logging.getLogger("worker")

POLL_SEC = 1.0
INGEST_INTERVAL_SEC = int(os.environ.get("INGEST_INTERVAL_SEC", "900"))


async def _dispatch(sf, job, sem: asyncio.Semaphore) -> None:
    """Run a single claimed job, always releasing the semaphore on exit."""
    try:
        runner = jobs_runner.RUNNERS.get(job.kind)
        if runner is None:
            log.warning("unknown job kind: %s", job.kind)
        else:
            await runner(sf, job.id)
    finally:
        sem.release()


async def run_until_idle(
    sf,
    *,
    worker_id: str,
    concurrency: int,
    max_idle_polls: int,
    poll_sec: float = POLL_SEC,
) -> None:
    """Test-friendly supervisor: exits after ``max_idle_polls`` empty polls.

    On each iteration: acquire from the semaphore, attempt to claim a job. If
    the queue is empty, release + sleep + bump the idle counter. On a
    successful claim, dispatch as a task and reset the idle counter. Drains
    in-flight tasks before returning.
    """
    sem = asyncio.Semaphore(concurrency)
    idle = 0
    inflight: set[asyncio.Task] = set()
    while idle < max_idle_polls:
        await sem.acquire()
        job = await claim_one(sf, worker_id=worker_id)
        if job is None:
            sem.release()
            idle += 1
            await asyncio.sleep(poll_sec)
            continue
        idle = 0
        t = asyncio.create_task(_dispatch(sf, job, sem))
        inflight.add(t)
        t.add_done_callback(inflight.discard)
    if inflight:
        await asyncio.gather(*inflight, return_exceptions=True)


async def _enqueue_due_ingests(sf) -> None:
    """Enqueue an ``ingest_greenhouse`` job for every enabled company that
    does not already have one queued or running.

    JSONB ``->>`` works on Postgres but not SQLite; rather than branch on
    dialect we filter inflight jobs in Python after pulling the small set
    of queued/running ingest jobs. The cardinality is bounded by the
    enabled-companies count so this is cheap.
    """
    async with sf() as s:
        enabled = (
            await s.execute(
                select(Company).where(Company.enabled.is_(True))
            )
        ).scalars().all()

        inflight = (
            await s.execute(
                select(Job).where(
                    Job.kind == "ingest_greenhouse",
                    Job.status.in_(("queued", "running")),
                )
            )
        ).scalars().all()
        inflight_slugs = {
            (j.payload or {}).get("company_slug") for j in inflight
        }

        for c in enabled:
            if c.slug in inflight_slugs:
                continue
            await enqueue_ingest_greenhouse(s, company_slug=c.slug)
        await s.commit()


async def _enqueue_due_amode_submits(sf) -> None:
    """Enqueue ``submit_application`` jobs for prepared A-mode applications
    whose tier still has cap headroom today.

    Skips applications that already have a queued/running
    ``submit_application`` job — mirrors the dedup pattern used by
    :func:`_enqueue_due_ingests`. Honors the
    ``AUTONOMOUS_SUBMIT_DISABLED=1`` kill switch by short-circuiting the
    entire branch.
    """
    if os.environ.get("AUTONOMOUS_SUBMIT_DISABLED") == "1":
        return

    async with sf() as s:
        # Pull the prepared A-mode applications + their posting tier.
        prepared = (
            await s.execute(
                select(Application, JobPosting.tier)
                .join(JobPosting, JobPosting.id == Application.posting_id)
                .where(
                    Application.status == "prepared",
                    Application.mode == "A",
                )
                .order_by(Application.prepared_at)
            )
        ).all()

        if not prepared:
            return

        # Look up tier policies in one shot.
        tier_slugs = {t for _, t in prepared if t}
        tier_rows = (
            await s.execute(select(Tier).where(Tier.slug.in_(tier_slugs)))
        ).scalars().all() if tier_slugs else []
        tier_caps = {t.slug: t.daily_cap for t in tier_rows}

        # Already-inflight submit jobs to dedup against.
        inflight = (
            await s.execute(
                select(Job).where(
                    Job.kind == "submit_application",
                    Job.status.in_(("queued", "running")),
                )
            )
        ).scalars().all()
        inflight_app_ids = {
            (j.payload or {}).get("application_id") for j in inflight
        }

        # Track per-tier remaining headroom so we don't enqueue more than
        # the cap allows on a single tick.
        remaining: dict[str, int] = {}
        for slug in tier_slugs:
            cap = tier_caps.get(slug, 0) or 0
            if cap <= 0:
                remaining[slug] = 0
            else:
                today = await count_submitted_today_for_tier(
                    s, tier_slug=slug
                )
                remaining[slug] = max(0, cap - today)

        for app, tier_slug in prepared:
            if not tier_slug:
                continue
            if remaining.get(tier_slug, 0) <= 0:
                continue
            if app.id in inflight_app_ids:
                continue
            await enqueue_submit_application(s, application_id=app.id)
            remaining[tier_slug] -= 1
            inflight_app_ids.add(app.id)

        await s.commit()


async def _scheduler(sf, shutdown: asyncio.Event) -> None:
    """Periodically enqueue ingest_greenhouse + autonomous submit jobs.

    Runs once on entry, then every ``INGEST_INTERVAL_SEC`` seconds until
    ``shutdown`` is set. Errors in either branch are logged but do not stop
    the loop.
    """
    while not shutdown.is_set():
        try:
            await _enqueue_due_ingests(sf)
        except Exception:
            log.exception("scheduler error (ingest)")
        try:
            await _enqueue_due_amode_submits(sf)
        except Exception:
            log.exception("scheduler error (a-mode submits)")
        try:
            await asyncio.wait_for(
                shutdown.wait(), timeout=INGEST_INTERVAL_SEC
            )
        except asyncio.TimeoutError:
            pass


async def main() -> None:
    """Production entrypoint. Runs until SIGINT/SIGTERM, then drains."""
    logging.basicConfig(level=logging.INFO)
    worker_id = f"worker-{uuid.uuid4()}"
    concurrency = int(os.environ.get("WORKER_CONCURRENCY", "4"))
    log.info("worker %s starting concurrency=%d", worker_id, concurrency)

    await reclaim_stale_jobs(SessionLocal, after_seconds=60)
    # Companies are seeded by Alembic migration 0012; no boot-time seed.

    shutdown = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, shutdown.set)

    scheduler_task = asyncio.create_task(_scheduler(SessionLocal, shutdown))

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
            try:
                runner = jobs_runner.RUNNERS.get(j.kind)
                if runner is None:
                    log.warning("unknown job kind: %s", j.kind)
                else:
                    await runner(SessionLocal, j.id)
            finally:
                sem.release()

        t = asyncio.create_task(_wrap(job))
        inflight.add(t)
        t.add_done_callback(inflight.discard)

    scheduler_task.cancel()
    try:
        await scheduler_task
    except asyncio.CancelledError:
        pass

    log.info("worker draining %d jobs", len(inflight))
    if inflight:
        await asyncio.gather(*inflight, return_exceptions=True)


if __name__ == "__main__":
    asyncio.run(main())
