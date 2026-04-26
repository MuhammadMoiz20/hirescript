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
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Job, JobDescription, Resume
from app.services.jobs_repo import emit_event
from app.services.tailor import tailor_resume
from app.services.versioning import snapshot_resume_version

SessionFactory = Callable[[], AsyncSession]

HEARTBEAT_SEC = 10


async def _heartbeat(sf: SessionFactory, job_id: uuid.UUID) -> None:
    """Bump ``heartbeat_at`` every ``HEARTBEAT_SEC`` seconds until cancelled."""
    while True:
        await asyncio.sleep(HEARTBEAT_SEC)
        async with sf() as s:
            await s.execute(
                update(Job)
                .where(Job.id == job_id)
                .values(heartbeat_at=datetime.now(timezone.utc))
            )
            await s.commit()


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

        await emit_event(sf, job_id, phase="done", message=None, data={})

    except asyncio.CancelledError:
        # Idempotent: only flip rows that aren't already cancelled.
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
        await emit_event(sf, job_id, phase="cancelled", message=None, data={})

    except Exception as exc:  # noqa: BLE001 — terminal catch-all per spec
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

    finally:
        hb.cancel()
        # Drain the cancellation so the task doesn't leak a CancelledError
        # warning into the worker loop.
        with contextlib.suppress(asyncio.CancelledError):
            await hb
