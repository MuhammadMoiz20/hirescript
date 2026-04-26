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

from app.db import SessionLocal
from app.services import jobs_runner
from app.services.jobs_repo import claim_one, reclaim_stale_jobs

log = logging.getLogger("worker")

POLL_SEC = 1.0


async def _dispatch(sf, job, sem: asyncio.Semaphore) -> None:
    """Run a single claimed job, always releasing the semaphore on exit."""
    try:
        if job.kind == "tailor":
            await jobs_runner.run_tailor_job(sf, job.id)
        else:
            log.warning("unknown job kind: %s", job.kind)
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


async def main() -> None:
    """Production entrypoint. Runs until SIGINT/SIGTERM, then drains."""
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
            try:
                await jobs_runner.run_tailor_job(SessionLocal, j.id)
            finally:
                sem.release()

        t = asyncio.create_task(_wrap(job))
        inflight.add(t)
        t.add_done_callback(inflight.discard)

    log.info("worker draining %d jobs", len(inflight))
    if inflight:
        await asyncio.gather(*inflight, return_exceptions=True)


if __name__ == "__main__":
    asyncio.run(main())
