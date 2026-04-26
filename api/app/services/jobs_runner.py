"""Tailor job runner.

Pure async function the worker calls once it has claimed a ``tailor`` job.
The runner:

1. Loads the master resume from the DB.
2. Calls :func:`app.services.tailor.tailor_resume` with an ``on_progress``
   callback that appends a ``JobEvent`` row per phase and aborts (via
   ``asyncio.CancelledError``) if the job has been flipped to ``cancelled``
   out-of-band by the API.
3. On success, persists a ``JobDescription`` + variant ``Resume`` +
   ``ResumeVersion`` snapshot — mirroring the inline tailor route at
   ``app/routes/resumes.py`` — and writes the terminal ``done`` event +
   ``status='succeeded'`` with the result payload.
4. On cancellation, marks ``status='cancelled'`` (idempotent w.r.t. an
   already-cancelled row) and emits a ``cancelled`` event.
5. On any other exception, marks ``status='failed'`` with a truncated error
   message and emits a ``failed`` event.

A sidecar coroutine bumps ``heartbeat_at`` every :data:`HEARTBEAT_SEC`
seconds so the stale-job reaper can tell live workers from dead ones.

The one-page invariant is upheld by ``tailor_resume`` itself; the runner
just propagates ``result.page_count`` verbatim.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

import httpx

from app.models import Company, Job, JobDescription, Resume
from app.services.classify import classify_posting
from app.services.jobs_repo import emit_event, enqueue_classify_posting
from app.services.sources.greenhouse import (
    fetch_company_jobs,
    upsert_postings,
)
from app.services.tailor import tailor_resume
from app.services.versioning import snapshot_resume_version

SessionFactory = Callable[[], AsyncSession]

HEARTBEAT_SEC = 10


class _NotOnePageError(Exception):
    """Raised when ``tailor_resume`` returns a non-enforced result.

    Carries ``page_count`` + ``iterations`` so the route layer (or any
    inline caller) can translate it into a structured 422 response.
    """

    def __init__(self, *, page_count: int, iterations: int) -> None:
        super().__init__(f"not_one_page page_count={page_count}")
        self.page_count = page_count
        self.iterations = iterations


async def _bump_heartbeat(sf: SessionFactory, job_id: uuid.UUID) -> None:
    async with sf() as s:
        await s.execute(
            update(Job)
            .where(Job.id == job_id)
            .values(heartbeat_at=datetime.now(timezone.utc))
        )
        await s.commit()


async def _heartbeat(sf: SessionFactory, job_id: uuid.UUID) -> None:
    """Bump ``heartbeat_at`` every ``HEARTBEAT_SEC`` seconds until cancelled.

    Bumps once on entry so a fast-cancelled job has a non-null heartbeat.
    Transient DB errors are logged and swallowed so a single blip does not
    terminate the heartbeat for the rest of the run.
    """
    try:
        await _bump_heartbeat(sf, job_id)
    except Exception:  # noqa: BLE001 — best-effort, see docstring
        logger.warning("heartbeat bump failed for job %s", job_id, exc_info=True)
    while True:
        await asyncio.sleep(HEARTBEAT_SEC)
        try:
            await _bump_heartbeat(sf, job_id)
        except Exception:  # noqa: BLE001 — best-effort, see docstring
            logger.warning(
                "heartbeat bump failed for job %s", job_id, exc_info=True
            )


async def _is_cancelled(sf: SessionFactory, job_id: uuid.UUID) -> bool:
    async with sf() as s:
        st = (
            await s.execute(select(Job.status).where(Job.id == job_id))
        ).scalar_one()
        return st == "cancelled"


async def run_tailor_job(sf: SessionFactory, job_id: uuid.UUID) -> None:
    """Execute a queued tailor job to completion (success / cancel / fail)."""
    hb = asyncio.create_task(_heartbeat(sf, job_id))
    try:
        # 1. Load job + master resume snapshot. We pull primitive fields here
        # so we don't keep an ORM-attached session open across the long-running
        # tailor call.
        async with sf() as s:
            job = (
                await s.execute(select(Job).where(Job.id == job_id))
            ).scalar_one()
            payload: dict[str, Any] = job.payload or {}
            master = (
                await s.execute(
                    select(Resume).where(Resume.id == payload["resume_id"])
                )
            ).scalar_one()
            master_latex = master.latex_source
            master_protected = list(master.protected_terms or [])
            master_id = master.id
            master_name = master.name
            master_template_id = master.template_id

        async def on_progress(event: str, data: dict[str, Any]) -> None:
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

        # If the enforcer couldn't get the tailored variant down to one page
        # we refuse to persist it — surface this as a structured failure so
        # the API can translate it to a 422 ``not_one_page`` response.
        if not result.enforced:
            raise _NotOnePageError(
                page_count=result.page_count, iterations=result.iterations
            )

        # 2. Persist JD + variant + version snapshot, mirror tailor route.
        async with sf() as s:
            jd = JobDescription(
                user_id=1,
                title=payload["title"],
                company=payload["company"],
                url=payload.get("url"),
                raw_text=payload["jd_text"],
                parsed_json={"keywords": result.keywords_used},
            )
            s.add(jd)
            await s.flush()

            variant = Resume(
                user_id=1,
                parent_id=master_id,
                kind="variant",
                name=f"{master_name} \u2014 {payload['company']}",
                template_id=master_template_id,
                latex_source=result.variant_latex,
                job_description_id=jd.id,
                protected_terms=master_protected,
            )
            s.add(variant)
            await s.flush()

            await snapshot_resume_version(
                db=s,
                resume=variant,
                page_count=result.page_count,
                edit_source="ai_tailor",
                edit_prompt=f"{payload['title']} @ {payload['company']}",
                pdf_bytes=result.pdf,
            )

            await s.execute(
                update(Job)
                .where(Job.id == job_id)
                .values(
                    status="succeeded",
                    finished_at=datetime.now(timezone.utc),
                    result={
                        "variant_id": variant.id,
                        "jd_id": jd.id,
                        "page_count": result.page_count,
                        "iterations": result.iterations,
                        "enforced": result.enforced,
                        "tier_history": result.tier_history,
                        "keywords_used": result.keywords_used,
                    },
                )
            )
            await s.commit()

        # Result is committed; the done event is best-effort.
        try:
            await emit_event(sf, job_id, phase="done", message=None, data={})
        except Exception:  # noqa: BLE001
            logger.exception("emit done event failed for job %s", job_id)

    except asyncio.CancelledError:
        # Idempotent: only flip rows that aren't already cancelled.
        try:
            async with sf() as s:
                await s.execute(
                    update(Job)
                    .where(Job.id == job_id, Job.status != "cancelled")
                    .values(
                        status="cancelled",
                        finished_at=datetime.now(timezone.utc),
                    )
                )
                await s.commit()
            await emit_event(
                sf, job_id, phase="cancelled", message=None, data={}
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "terminal cancel handler failed for job %s", job_id
            )

    except _NotOnePageError as exc:
        try:
            async with sf() as s:
                await s.execute(
                    update(Job)
                    .where(Job.id == job_id)
                    .values(
                        status="failed",
                        finished_at=datetime.now(timezone.utc),
                        result={
                            "error": "not_one_page",
                            "page_count": exc.page_count,
                            "iterations": exc.iterations,
                        },
                    )
                )
                await s.commit()
            await emit_event(
                sf,
                job_id,
                phase="failed",
                message="not_one_page",
                data={
                    "error": "not_one_page",
                    "page_count": exc.page_count,
                    "iterations": exc.iterations,
                },
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "terminal failure handler failed for job %s", job_id
            )

    except Exception as exc:  # noqa: BLE001 — terminal catch-all per spec
        try:
            async with sf() as s:
                await s.execute(
                    update(Job)
                    .where(Job.id == job_id)
                    .values(
                        status="failed",
                        finished_at=datetime.now(timezone.utc),
                        result={"error": str(exc)[:500]},
                    )
                )
                await s.commit()
            await emit_event(
                sf, job_id, phase="failed", message=str(exc)[:500], data={}
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "terminal failure handler failed for job %s", job_id
            )

    finally:
        hb.cancel()
        # Drain the cancellation so the task doesn't leak a CancelledError
        # warning into the worker loop.
        with contextlib.suppress(asyncio.CancelledError):
            await hb


async def run_ingest_greenhouse_job(
    sf: SessionFactory, job_id: uuid.UUID
) -> None:
    """Fetch + upsert Greenhouse postings for ``payload['company_slug']``.

    Mirrors the heartbeat / terminal-status structure of
    :func:`run_tailor_job`. On any unexpected exception, marks the job
    ``failed`` and emits a ``failed`` event with the truncated error.

    A 404 from Greenhouse is *not* an error — the fetcher returns an
    empty list and we record a successful run with zero postings, so a
    temporarily-broken board does not stall the scheduler.
    """
    hb = asyncio.create_task(_heartbeat(sf, job_id))
    try:
        async with sf() as s:
            job = (
                await s.execute(select(Job).where(Job.id == job_id))
            ).scalar_one()
            payload: dict[str, Any] = job.payload or {}
            slug = payload["company_slug"]

            company = (
                await s.execute(
                    select(Company).where(Company.slug == slug)
                )
            ).scalar_one_or_none()
            company_id = company.id if company else None

        await emit_event(
            sf,
            job_id,
            phase="ingest_start",
            message=f"Fetching {slug}",
            data={"slug": slug},
        )
        async with httpx.AsyncClient(timeout=30) as http:
            postings = await fetch_company_jobs(slug, http=http)
        await emit_event(
            sf,
            job_id,
            phase="ingest_fetched",
            message=f"Fetched {len(postings)} postings",
            data={"count": len(postings), "slug": slug},
        )

        async with sf() as s:
            counts = await upsert_postings(
                s,
                user_id=1,
                company_id=company_id,
                source="greenhouse",
                postings=postings,
            )

        # Enqueue a classify job per newly-created posting. We do this in a
        # fresh session so the upsert_postings commit is durable before we
        # add follow-up rows. Counts are JSON-serializable.
        created_ids = list(counts.get("created_ids") or [])
        if created_ids:
            async with sf() as s:
                for pid in created_ids:
                    await enqueue_classify_posting(s, posting_id=pid)
                await s.commit()

        # Strip the *_ids lists from the event payload so SSE consumers stay
        # lean; the counts scalars are sufficient for UI feedback.
        event_data = {
            "created": counts["created"],
            "updated": counts["updated"],
            "unchanged": counts["unchanged"],
        }
        await emit_event(
            sf,
            job_id,
            phase="ingest_upserted",
            message=(
                f"created={counts['created']} "
                f"updated={counts['updated']} "
                f"unchanged={counts['unchanged']}"
            ),
            data=event_data,
        )

        async with sf() as s:
            await s.execute(
                update(Job)
                .where(Job.id == job_id)
                .values(
                    status="succeeded",
                    finished_at=datetime.now(timezone.utc),
                    result={"slug": slug, **event_data},
                )
            )
            await s.commit()

        try:
            await emit_event(
                sf, job_id, phase="done", message=None, data=event_data
            )
        except Exception:  # noqa: BLE001
            logger.exception("emit done event failed for job %s", job_id)

    except Exception as exc:  # noqa: BLE001 — terminal catch-all per spec
        try:
            async with sf() as s:
                await s.execute(
                    update(Job)
                    .where(Job.id == job_id)
                    .values(
                        status="failed",
                        finished_at=datetime.now(timezone.utc),
                        result={"error": str(exc)[:500]},
                    )
                )
                await s.commit()
            await emit_event(
                sf,
                job_id,
                phase="failed",
                message=str(exc)[:500],
                data={"error": str(exc)[:500]},
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "terminal failure handler failed for job %s", job_id
            )

    finally:
        hb.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await hb


async def run_classify_posting_job(
    sf: SessionFactory, job_id: uuid.UUID
) -> None:
    """Execute a queued ``classify_posting`` job.

    Reads ``payload['posting_id']`` and runs :func:`classify_posting`,
    emitting ``classify_start`` / ``classify_done`` / ``done`` events
    (or a terminal ``failed`` event on any exception).
    """
    hb = asyncio.create_task(_heartbeat(sf, job_id))
    try:
        async with sf() as s:
            job = (
                await s.execute(select(Job).where(Job.id == job_id))
            ).scalar_one()
            payload: dict[str, Any] = job.payload or {}
            posting_id = int(payload["posting_id"])

        await emit_event(
            sf,
            job_id,
            phase="classify_start",
            message=None,
            data={"posting_id": posting_id},
        )

        async with sf() as s:
            result = await classify_posting(s, posting_id=posting_id)

        await emit_event(
            sf,
            job_id,
            phase="classify_done",
            message=None,
            data=result,
        )

        async with sf() as s:
            await s.execute(
                update(Job)
                .where(Job.id == job_id)
                .values(
                    status="succeeded",
                    finished_at=datetime.now(timezone.utc),
                    result={"posting_id": posting_id, **result},
                )
            )
            await s.commit()

        try:
            await emit_event(
                sf, job_id, phase="done", message=None, data=result
            )
        except Exception:  # noqa: BLE001
            logger.exception("emit done event failed for job %s", job_id)

    except Exception as exc:  # noqa: BLE001 — terminal catch-all per spec
        try:
            async with sf() as s:
                await s.execute(
                    update(Job)
                    .where(Job.id == job_id)
                    .values(
                        status="failed",
                        finished_at=datetime.now(timezone.utc),
                        result={"error": str(exc)[:500]},
                    )
                )
                await s.commit()
            await emit_event(
                sf,
                job_id,
                phase="failed",
                message=str(exc)[:500],
                data={"error": str(exc)[:500]},
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "terminal failure handler failed for job %s", job_id
            )

    finally:
        hb.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await hb


# Dispatch table mapping job ``kind`` -> async runner. New runners (slice 2+)
# register themselves here so the worker supervisor stays kind-agnostic.
# NOTE: tests must use monkeypatch.setitem(RUNNERS, kind, fake), not
# monkeypatch.setattr on the module-level callable — the dict captures
# the function reference at import time, so patching the bound name
# does not update what gets dispatched.
RUNNERS: dict[str, Callable[[SessionFactory, uuid.UUID], Awaitable[None]]] = {
    "tailor": run_tailor_job,
    "ingest_greenhouse": run_ingest_greenhouse_job,
    "classify_posting": run_classify_posting_job,
}
