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
import os
import tempfile
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

import httpx

from sqlalchemy.exc import IntegrityError

from app.models import (
    Application,
    ApplicationResearch,
    Company,
    Job,
    JobDescription,
    JobPosting,
    Profile as ProfileModel,
    Resume,
    ResumeVersion,
    Tier,
)
from app.schemas.profile import Profile
from app.services import answer_cache, notifications
from app.services.agents import discover_companies as agent_discover
from app.services.agents import dream_research as agent_dream
from app.services.canonical import canonicalize
from app.services.classify import classify_posting
from app.services.cover_letter import generate_cover_letter
from app.services.jobs_repo import (
    count_submitted_today_for_tier,
    emit_event,
    enqueue_classify_posting,
)
from app.services.sources import SOURCES
from app.services.sources.greenhouse import (
    fetch_company_jobs,
    upsert_postings,
)
from app.services.submit_adapters import agent_submit
from app.services.submit_adapters import greenhouse as greenhouse_submit
from app.services.submit_adapters.protocol import AdapterUnsupported
from app.services.submit_adapters.registry import ADAPTERS
from app.services.tailor import tailor_resume
from app.services.tailor_for_application import tailor_for_application
from app.services import verify
from app.services.versioning import snapshot_resume_version

SessionFactory = Callable[[], AsyncSession]

HEARTBEAT_SEC = 10


class _NeedsAttention(Exception):
    """Raised when the runner refuses to drive a submit and the application
    must be parked for human review.

    Currently used by the agent-fallback path when the application is in
    A-mode — the browser-agent is B-mode-only this slice, so an unknown-
    source posting in A-mode lands in ``status='needs_attention'`` for the
    user to review and either flip to B-mode or re-target. Distinct from a
    generic ``RuntimeError`` so the handler can write a deterministic error
    message + status without conflating it with a real failure.
    """


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


async def run_ingest_source_job(
    sf: SessionFactory, job_id: uuid.UUID
) -> None:
    """Fetch + upsert postings for ``payload['source']`` + ``['company_slug']``.

    Looks up the adapter in :data:`app.services.sources.SOURCES`. Mirrors
    the heartbeat / terminal-status structure of :func:`run_tailor_job`.
    A 404 from the upstream board is normalized to ``[]`` by the adapter,
    so a temporarily-broken company board does not stall the scheduler.
    Companies are looked up by ``(slug, source)`` so different ATS families
    can share a slug (e.g. ``linear:greenhouse`` vs ``linear:ashby``).
    """
    hb = asyncio.create_task(_heartbeat(sf, job_id))
    try:
        async with sf() as s:
            job = (
                await s.execute(select(Job).where(Job.id == job_id))
            ).scalar_one()
            payload: dict[str, Any] = job.payload or {}
            source_name = payload["source"]
            slug = payload["company_slug"]

            adapter = SOURCES.get(source_name)
            if adapter is None:
                raise ValueError(f"unknown source: {source_name!r}")

            company = (
                await s.execute(
                    select(Company).where(
                        Company.slug == slug, Company.source == source_name
                    )
                )
            ).scalar_one_or_none()
            company_id = company.id if company else None

        await emit_event(
            sf,
            job_id,
            phase="ingest_start",
            message=f"Fetching {source_name}:{slug}",
            data={"slug": slug, "source": source_name},
        )
        async with httpx.AsyncClient(timeout=30) as http:
            postings = await adapter.fetch_company_postings(slug, http=http)
        await emit_event(
            sf,
            job_id,
            phase="ingest_fetched",
            message=f"Fetched {len(postings)} postings",
            data={
                "count": len(postings),
                "slug": slug,
                "source": source_name,
            },
        )

        async with sf() as s:
            counts = await upsert_postings(
                s,
                user_id=1,
                company_id=company_id,
                source=source_name,
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
                    result={"slug": slug, "source": source_name, **event_data},
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


async def run_ingest_greenhouse_job(
    sf: SessionFactory, job_id: uuid.UUID
) -> None:
    """Backwards-compat shim — promotes the legacy payload to the new shape.

    The legacy ``{"company_slug": ...}`` payload is rewritten in place to
    ``{"source": "greenhouse", "company_slug": ...}`` so the generalized
    runner can consume it. This shim is dropped in slice 5 once the
    scheduler stops enqueuing the legacy kind.
    """
    async with sf() as s:
        job = (
            await s.execute(select(Job).where(Job.id == job_id))
        ).scalar_one()
        payload: dict[str, Any] = dict(job.payload or {})
        if payload.get("source") != "greenhouse":
            payload["source"] = "greenhouse"
            await s.execute(
                update(Job).where(Job.id == job_id).values(payload=payload)
            )
            await s.commit()
    await run_ingest_source_job(sf, job_id)


async def run_ingest_gmail_job(
    sf: SessionFactory, job_id: uuid.UUID
) -> None:
    """Poll Gmail and ingest extracted postings.

    Calls :func:`gmail_digest.poll_and_ingest` with ``user_id=1`` per
    the single-tenant phase. Emits a ``progress`` event with the
    created count and marks the job ``succeeded``. Any exception is
    captured as a terminal ``failed`` event.
    """
    from app.services.sources import gmail_digest

    hb = asyncio.create_task(_heartbeat(sf, job_id))
    try:
        async with sf() as s:
            count = await gmail_digest.poll_and_ingest(s, user_id=1)

        await emit_event(
            sf,
            job_id,
            phase="progress",
            message=f"created={count}",
            data={"created": int(count or 0)},
        )

        async with sf() as s:
            await s.execute(
                update(Job)
                .where(Job.id == job_id)
                .values(
                    status="succeeded",
                    finished_at=datetime.now(timezone.utc),
                    result={"created": int(count or 0)},
                )
            )
            await s.commit()

        try:
            await emit_event(
                sf, job_id, phase="done", message=None, data={}
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


def _split_legal_name(legal_name: str | None) -> tuple[str, str]:
    if not legal_name:
        return "", ""
    parts = legal_name.split()
    if not parts:
        return "", ""
    return parts[0], " ".join(parts[1:])


async def _build_form_payload(
    db: AsyncSession, *, profile_data: dict[str, Any]
) -> dict[str, Any]:
    """Seed the application form payload from the user's profile + answer cache."""
    profile = Profile.model_validate(profile_data) if profile_data else None
    legal_name = profile.legal_name if profile else ""
    first, last = _split_legal_name(legal_name)
    email = (profile.email if profile else None) or ""
    phone = (profile.phone if profile else None) or ""
    links = (profile.links if profile else {}) or {}
    why_company = (
        await answer_cache.lookup(
            db, user_id=1, question="Why this company?"
        )
    ) or ""
    return {
        "first_name": first,
        "last_name": last,
        "email": email,
        "phone": phone,
        "linkedin": links.get("linkedin", ""),
        "github": links.get("github", ""),
        "website": links.get("site", ""),
        "why_company": why_company,
    }


async def _mark_posting_errored(
    sf: SessionFactory, posting_id: int
) -> None:
    """Set posting.status='errored' in a fresh session.

    Called from the terminal failure handler so a poisoned outer
    transaction can't block the status update.
    """
    try:
        async with sf() as s:
            await s.execute(
                update(JobPosting)
                .where(JobPosting.id == posting_id)
                .values(status="errored")
            )
            await s.commit()
    except Exception:  # noqa: BLE001
        logger.exception(
            "failed to mark posting %s as errored", posting_id
        )


async def run_prepare_application_job(
    sf: SessionFactory, job_id: uuid.UUID
) -> None:
    """Tailor + write a cover letter + seed a form payload for a posting.

    Steps:

    1. Load the :class:`JobPosting` and the user's :class:`Profile`.
    2. Compute and persist ``posting.canonical_key``.
    3. Pre-submit dedup gate: if an :class:`Application` already exists for
       this user with the same canonical_key, mark
       ``posting.status='duplicate_skipped'`` and return early.
    4. Mark ``posting.status='preparing'``, call
       :func:`tailor_for_application` (which commits internally) and
       :func:`generate_cover_letter`.
    5. Build a ``form_payload`` from profile + answer_cache.
    6. Insert :class:`Application`. Race-safe with the unique index — on
       ``IntegrityError`` we treat the posting as a duplicate skip.
    7. Mark ``posting.status='ready'`` and finish.
    """
    hb = asyncio.create_task(_heartbeat(sf, job_id))
    posting_id: int | None = None
    try:
        async with sf() as s:
            job = (
                await s.execute(select(Job).where(Job.id == job_id))
            ).scalar_one()
            payload: dict[str, Any] = job.payload or {}
            posting_id = int(payload["posting_id"])

            posting = (
                await s.execute(
                    select(JobPosting).where(JobPosting.id == posting_id)
                )
            ).scalar_one_or_none()
            if posting is None:
                raise ValueError(f"posting {posting_id} not found")

            company_name: str | None = None
            if posting.company_id is not None:
                company_row = (
                    await s.execute(
                        select(Company).where(Company.id == posting.company_id)
                    )
                ).scalar_one_or_none()
                if company_row is not None:
                    company_name = company_row.display_name

            canonical_key = canonicalize(company_name, posting.apply_url)
            posting.canonical_key = canonical_key

            existing = (
                await s.execute(
                    select(Application.id).where(
                        Application.user_id == 1,
                        Application.canonical_key == canonical_key,
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                posting.status = "duplicate_skipped"
                await s.commit()
                await emit_event(
                    sf,
                    job_id,
                    phase="duplicate_skipped",
                    message="already applied",
                    data={"posting_id": posting_id},
                )
                async with sf() as s2:
                    await s2.execute(
                        update(Job)
                        .where(Job.id == job_id)
                        .values(
                            status="succeeded",
                            finished_at=datetime.now(timezone.utc),
                            result={
                                "posting_id": posting_id,
                                "skipped": True,
                                "reason": "already applied",
                            },
                        )
                    )
                    await s2.commit()
                try:
                    await emit_event(
                        sf, job_id, phase="done", message=None, data={}
                    )
                except Exception:  # noqa: BLE001
                    logger.exception(
                        "emit done event failed for job %s", job_id
                    )
                return

            posting.status = "preparing"
            await s.commit()

        # 2. Tailor (commits its own session work). Must be its own session.
        async with sf() as s:
            tailor_result = await tailor_for_application(
                s, user_id=1, posting_id=posting_id
            )
        await emit_event(
            sf,
            job_id,
            phase="tailored",
            message=None,
            data={
                "variant_id": tailor_result["variant_id"],
                "page_count": tailor_result["page_count"],
                "iterations": tailor_result["iterations"],
                "enforced": tailor_result["enforced"],
            },
        )

        # 3. Cover letter (read-only — no commit needed).
        async with sf() as s:
            cover_letter_text = await generate_cover_letter(
                s, user_id=1, posting_id=posting_id
            )
        await emit_event(
            sf,
            job_id,
            phase="cover_letter_generated",
            message=None,
            data={"length": len(cover_letter_text)},
        )

        # 4. Build form_payload (touches answer_cache — flush only).
        async with sf() as s:
            profile_row = (
                await s.execute(
                    select(ProfileModel).where(ProfileModel.user_id == 1)
                )
            ).scalar_one_or_none()
            profile_data = profile_row.data if profile_row is not None else {}
            form_payload = await _build_form_payload(
                s, profile_data=profile_data or {}
            )

            application = Application(
                user_id=1,
                posting_id=posting_id,
                mode="B",
                status="prepared",
                resume_variant_id=tailor_result["variant_id"],
                cover_letter_text=cover_letter_text,
                form_payload=form_payload,
                canonical_key=canonical_key,
            )
            s.add(application)
            try:
                await s.flush()
            except IntegrityError:
                # A racing ingest path inserted a duplicate between our
                # pre-submit gate and now. Treat as duplicate_skipped.
                await s.rollback()
                async with sf() as s2:
                    await s2.execute(
                        update(JobPosting)
                        .where(JobPosting.id == posting_id)
                        .values(status="duplicate_skipped")
                    )
                    await s2.commit()
                await emit_event(
                    sf,
                    job_id,
                    phase="duplicate_skipped",
                    message="race: already applied",
                    data={"posting_id": posting_id},
                )
                async with sf() as s2:
                    await s2.execute(
                        update(Job)
                        .where(Job.id == job_id)
                        .values(
                            status="succeeded",
                            finished_at=datetime.now(timezone.utc),
                            result={
                                "posting_id": posting_id,
                                "skipped": True,
                                "reason": "already applied",
                            },
                        )
                    )
                    await s2.commit()
                try:
                    await emit_event(
                        sf, job_id, phase="done", message=None, data={}
                    )
                except Exception:  # noqa: BLE001
                    logger.exception(
                        "emit done event failed for job %s", job_id
                    )
                return

            await s.execute(
                update(JobPosting)
                .where(JobPosting.id == posting_id)
                .values(status="ready")
            )
            await s.commit()
            application_id = application.id
            posting_tier_for_research = (
                (await s.execute(
                    select(JobPosting.tier).where(JobPosting.id == posting_id)
                )).scalar_one_or_none()
            )

        # Dream-tier research: enqueue a one-shot dream_research job for
        # the freshly-prepared application. The runner persists onto
        # ``application_research`` (one row per application) and is a
        # no-op for non-dream postings.
        if posting_tier_for_research == "dream":
            async with sf() as s:
                s.add(
                    Job(
                        kind="dream_research",
                        status="queued",
                        payload={"application_id": application_id},
                    )
                )
                await s.commit()

        # Verify pass — judges grounding of tailored materials. Failure here
        # MUST NOT block preparation; we leave verify_ok=None so the submit
        # step can decide whether to gate on it. Submit (Batch C) treats
        # None as "not verified, allow only B-mode".
        try:
            async with sf() as s:
                verdict = await verify.verify_application(
                    s, application_id=application_id
                )
                await s.execute(
                    update(Application)
                    .where(Application.id == application_id)
                    .values(
                        verify_ok=verdict["ok"],
                        verify_issues=list(verdict["issues"]),
                        verify_rationale=verdict["rationale"],
                    )
                )
                await s.commit()
            await emit_event(
                sf,
                job_id,
                phase="verified",
                message=None,
                data={
                    "ok": verdict["ok"],
                    "issue_count": len(verdict["issues"]),
                },
            )
        except Exception:  # noqa: BLE001 — verify is advisory at prepare time
            logger.exception(
                "verify_application failed for application %s; "
                "leaving verify_ok=None",
                application_id,
            )
            try:
                await emit_event(
                    sf,
                    job_id,
                    phase="verify_skipped",
                    message="verifier raised; verify_ok left null",
                    data={},
                )
            except Exception:  # noqa: BLE001
                logger.exception(
                    "emit verify_skipped event failed for job %s", job_id
                )

        async with sf() as s:
            await s.execute(
                update(Job)
                .where(Job.id == job_id)
                .values(
                    status="succeeded",
                    finished_at=datetime.now(timezone.utc),
                    result={
                        "posting_id": posting_id,
                        "application_id": application_id,
                        "page_count": tailor_result["page_count"],
                        "kb_chunks_used": tailor_result["kb_chunks_used"],
                    },
                )
            )
            await s.commit()

        try:
            await emit_event(
                sf,
                job_id,
                phase="done",
                message=None,
                data={
                    "application_id": application_id,
                    "page_count": tailor_result["page_count"],
                },
            )
        except Exception:  # noqa: BLE001
            logger.exception("emit done event failed for job %s", job_id)

    except Exception as exc:  # noqa: BLE001 — terminal catch-all per spec
        if posting_id is not None:
            await _mark_posting_errored(sf, posting_id)
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


async def _resolve_resume_pdf(
    sf: SessionFactory, *, resume_id: int, dest_dir: str
) -> str:
    """Materialize the latest ResumeVersion PDF for ``resume_id`` to disk.

    Tries MinIO/S3 (via ``compiled_pdf_key``) first; falls back to a local
    versions/<id>.pdf file if storage is unreachable. Raises if neither
    source can produce bytes — an empty resume is a hard fail because the
    submit can't proceed without a PDF.
    """
    async with sf() as s:
        version = (
            await s.execute(
                select(ResumeVersion)
                .where(ResumeVersion.resume_id == resume_id)
                .order_by(ResumeVersion.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
    if version is None:
        raise RuntimeError(
            f"no ResumeVersion for resume_id={resume_id}"
        )

    from app.services.storage import get_pdf

    os.makedirs(dest_dir, exist_ok=True)
    out_path = os.path.join(dest_dir, f"resume_{version.id}.pdf")

    pdf_bytes: bytes | None = None
    if version.compiled_pdf_key:
        try:
            pdf_bytes = get_pdf(key=version.compiled_pdf_key)
        except Exception:  # noqa: BLE001 — fall through to local fallback
            logger.warning(
                "storage get_pdf failed for key %s; trying local fallback",
                version.compiled_pdf_key,
            )

    if pdf_bytes is None:
        local = f"/app/compiled_pdfs/versions/{version.id}.pdf"
        if os.path.exists(local):
            with open(local, "rb") as f:
                pdf_bytes = f.read()

    if not pdf_bytes:
        raise RuntimeError(
            f"could not load PDF for ResumeVersion {version.id}"
        )

    with open(out_path, "wb") as f:
        f.write(pdf_bytes)
    return out_path


def _build_submit_context(
    *,
    application_id: int,
    apply_url: str,
    profile_data: dict[str, Any],
    resume_pdf_path: str,
    cover_letter_text: str,
    form_payload: dict[str, Any],
) -> dict[str, Any]:
    profile = (
        Profile.model_validate(profile_data) if profile_data else None
    )
    legal_name = profile.legal_name if profile else ""
    first, last = _split_legal_name(legal_name)
    email = (profile.email if profile else None) or ""
    phone = (profile.phone if profile else None) or ""
    links = (profile.links if profile else {}) or {}
    return {
        "application_id": application_id,
        "posting_apply_url": apply_url,
        "profile_first_name": form_payload.get("first_name") or first,
        "profile_last_name": form_payload.get("last_name") or last,
        "profile_email": form_payload.get("email") or email,
        "profile_phone": form_payload.get("phone") or phone,
        "profile_links": {
            "linkedin": form_payload.get("linkedin")
            or links.get("linkedin", ""),
            "github": form_payload.get("github") or links.get("github", ""),
            "site": form_payload.get("website") or links.get("site", ""),
        },
        "resume_pdf_path": resume_pdf_path,
        "cover_letter_text": cover_letter_text or "",
        "form_payload": form_payload or {},
    }


_CONFIRMATION_HTML_MAX = 65536
_CONFIRMATION_HTML_MARKER = "\n<!-- [truncated at 64KiB] -->"


def _truncate_confirmation(html: str) -> str:
    """Cap ``confirmation_html`` to 64KiB and append a visible marker.

    The marker tells anyone reading the raw HTML in the review queue that
    the prefix is incomplete — silent truncation would let a reviewer
    chase a missing closing tag they can't fix.
    """
    if len(html) <= _CONFIRMATION_HTML_MAX:
        return html
    return (
        html[: _CONFIRMATION_HTML_MAX - len(_CONFIRMATION_HTML_MARKER)]
        + _CONFIRMATION_HTML_MARKER
    )


_CAPTCHA_SCREENSHOT_DIR = "/app/compiled_pdfs/submit_screenshots"


def _make_captcha_handler(
    sf: SessionFactory, *, application_id: int
) -> Callable[[dict[str, Any]], Awaitable[None]]:
    """Build the ``on_captcha`` callback used during A-mode submits.

    The callback persists the captcha screenshot to the same volume
    B-mode uses for confirmation screenshots, flips the application row
    to ``status='captcha_pause'``, and emits an in-app + ntfy
    notification. The adapter then raises :class:`CaptchaPauseRequired`
    which the runner catches without marking the job failed.
    """

    async def _handle(ctx: dict[str, Any]) -> None:
        os.makedirs(_CAPTCHA_SCREENSHOT_DIR, exist_ok=True)
        ts = int(datetime.now(timezone.utc).timestamp())
        path = os.path.join(
            _CAPTCHA_SCREENSHOT_DIR,
            f"captcha_{application_id}_{ts}.png",
        )
        png = ctx.get("screenshot_png") or b""
        try:
            with open(path, "wb") as fh:
                fh.write(png)
        except Exception:  # noqa: BLE001
            logger.exception(
                "captcha screenshot write failed for application %s",
                application_id,
            )

        try:
            async with sf() as s:
                await s.execute(
                    update(Application)
                    .where(Application.id == application_id)
                    .values(
                        status="captcha_pause",
                        confirmation_screenshot_path=path,
                    )
                )
                user_id_row = (
                    await s.execute(
                        select(Application.user_id).where(
                            Application.id == application_id
                        )
                    )
                ).scalar_one()
                await s.commit()
        except Exception:  # noqa: BLE001
            logger.exception(
                "captcha-pause status update failed for application %s",
                application_id,
            )
            user_id_row = 1

        try:
            async with sf() as s:
                await notifications.send(
                    s,
                    user_id=int(user_id_row),
                    kind="captcha_pause",
                    title="Captcha required",
                    body=(
                        f"Application {application_id} paused on a "
                        f"Greenhouse captcha at {ctx.get('url', '')}."
                    ),
                    meta={
                        "application_id": application_id,
                        "screenshot_path": path,
                    },
                )
        except Exception:  # noqa: BLE001
            logger.exception(
                "captcha-pause notification failed for application %s",
                application_id,
            )

    return _handle


async def run_submit_application_job(
    sf: SessionFactory, job_id: uuid.UUID
) -> None:
    """Submit a prepared :class:`Application` via the Greenhouse adapter.

    Steps:

    1. Load the application + posting + profile.
    2. Re-check the dedup gate: if any *other* application with the same
       ``canonical_key`` is already submitted, mark this row
       ``duplicate_skipped`` without driving the browser.
    3. Flip status to ``submitting``, materialize the resume PDF.
    4. Build a :class:`SubmitContext`, drive the adapter, forward progress
       events as :class:`JobEvent` rows.
    5. On success: persist confirmation HTML (capped to 64KB to avoid
       JSONB bloat) + screenshot path + ``submitted_at``; flip the row to
       ``submitted`` and the posting to ``submitted``.
    6. On :class:`MissingFieldError` or any other exception: mark
       application ``errored`` + populate ``error``; mark job ``failed``.
       The row stays in the queue for human investigation.
    """
    hb = asyncio.create_task(_heartbeat(sf, job_id))
    application_id: int | None = None
    try:
        async with sf() as s:
            job = (
                await s.execute(select(Job).where(Job.id == job_id))
            ).scalar_one()
            payload: dict[str, Any] = job.payload or {}
            application_id = int(payload["application_id"])

            app = (
                await s.execute(
                    select(Application).where(Application.id == application_id)
                )
            ).scalar_one_or_none()
            if app is None:
                raise ValueError(
                    f"application {application_id} not found"
                )
            posting = (
                await s.execute(
                    select(JobPosting).where(JobPosting.id == app.posting_id)
                )
            ).scalar_one()

            # 2. Dedup gate — refuse if a sibling application has already
            # been submitted for the same canonical_key.
            already_submitted = (
                await s.execute(
                    select(Application.id).where(
                        Application.user_id == app.user_id,
                        Application.canonical_key == app.canonical_key,
                        Application.id != app.id,
                        Application.status == "submitted",
                    )
                )
            ).scalar_one_or_none()
            if already_submitted is not None:
                app.status = "duplicate_skipped"
                app.error = "another application already submitted"
                await s.commit()
                await emit_event(
                    sf,
                    job_id,
                    phase="duplicate_skipped",
                    message="already submitted",
                    data={"application_id": application_id},
                )
                async with sf() as s2:
                    await s2.execute(
                        update(Job)
                        .where(Job.id == job_id)
                        .values(
                            status="succeeded",
                            finished_at=datetime.now(timezone.utc),
                            result={
                                "application_id": application_id,
                                "skipped": True,
                                "reason": "already submitted",
                            },
                        )
                    )
                    await s2.commit()
                try:
                    await emit_event(
                        sf, job_id, phase="done", message=None, data={}
                    )
                except Exception:  # noqa: BLE001
                    logger.exception(
                        "emit done event failed for job %s", job_id
                    )
                return

            apply_url = posting.apply_url
            resume_variant_id = app.resume_variant_id
            cover_letter_text = app.cover_letter_text or ""
            form_payload = dict(app.form_payload or {})
            mode = app.mode
            posting_tier = posting.tier
            verify_ok = app.verify_ok

            # --- A-mode policy gates ---------------------------------------
            # Kill switch: refuse to drive the browser if the operator
            # disabled autonomous submits. Application stays prepared.
            if mode == "A" and (
                os.environ.get("AUTONOMOUS_SUBMIT_DISABLED") == "1"
            ):
                await s.commit()
                await emit_event(
                    sf,
                    job_id,
                    phase="disabled",
                    message="autonomous submit disabled",
                    data={"application_id": application_id},
                )
                async with sf() as s2:
                    await s2.execute(
                        update(Job)
                        .where(Job.id == job_id)
                        .values(
                            status="succeeded",
                            finished_at=datetime.now(timezone.utc),
                            result={
                                "application_id": application_id,
                                "skipped": True,
                                "reason": "autonomous_submit_disabled",
                            },
                        )
                    )
                    await s2.commit()
                return

            # Cap check: re-load the Tier row so a live PATCH on
            # ``tiers.daily_cap`` takes effect on the next worker tick. A
            # cap of 0 disables A-mode for the tier.
            if mode == "A":
                tier_row: Tier | None = None
                if posting_tier:
                    tier_row = (
                        await s.execute(
                            select(Tier).where(Tier.slug == posting_tier)
                        )
                    ).scalar_one_or_none()
                cap = tier_row.daily_cap if tier_row is not None else 0
                if cap <= 0:
                    today_count = 0
                else:
                    today_count = await count_submitted_today_for_tier(
                        s, tier_slug=posting_tier or ""
                    )
                if cap <= 0 or today_count >= cap:
                    await s.commit()
                    await emit_event(
                        sf,
                        job_id,
                        phase="cap_hit",
                        message="daily cap reached",
                        data={
                            "application_id": application_id,
                            "tier": posting_tier,
                            "cap": cap,
                            "today_count": today_count,
                        },
                    )
                    async with sf() as s2:
                        await s2.execute(
                            update(Job)
                            .where(Job.id == job_id)
                            .values(
                                status="succeeded",
                                finished_at=datetime.now(timezone.utc),
                                result={
                                    "application_id": application_id,
                                    "skipped": True,
                                    "reason": "cap_hit",
                                    "tier": posting_tier,
                                    "cap": cap,
                                    "today_count": today_count,
                                },
                            )
                        )
                        await s2.commit()
                    return

                # Verify gate: A-mode refuses to submit unverified or
                # explicitly-failing materials. Notification fires so the
                # user can review in the in-app drawer.
                if verify_ok is False:
                    await s.commit()
                    async with sf() as s2:
                        await notifications.send(
                            s2,
                            user_id=app.user_id,
                            kind="verify_blocked",
                            title="A-mode submit blocked",
                            body=(
                                "Verifier flagged unsupported claims; "
                                "review the application before submitting."
                            ),
                            meta={"application_id": application_id},
                        )
                    await emit_event(
                        sf,
                        job_id,
                        phase="verify_blocked",
                        message="verify_ok is False",
                        data={"application_id": application_id},
                    )
                    async with sf() as s2:
                        await s2.execute(
                            update(Job)
                            .where(Job.id == job_id)
                            .values(
                                status="succeeded",
                                finished_at=datetime.now(timezone.utc),
                                result={
                                    "application_id": application_id,
                                    "skipped": True,
                                    "reason": "verify_blocked",
                                },
                            )
                        )
                        await s2.commit()
                    return

            app.status = "submitting"
            app.error = None
            await s.commit()

            profile_row = (
                await s.execute(
                    select(ProfileModel).where(
                        ProfileModel.user_id == app.user_id
                    )
                )
            ).scalar_one_or_none()
            profile_data = (
                profile_row.data if profile_row is not None else {}
            ) or {}

        if resume_variant_id is None:
            raise RuntimeError(
                "application has no resume_variant_id; "
                "cannot submit without a tailored resume"
            )

        # Materialize the PDF into a per-job temp dir we clean up on exit.
        with tempfile.TemporaryDirectory(prefix="submit_") as tmpdir:
            resume_pdf_path = await _resolve_resume_pdf(
                sf, resume_id=resume_variant_id, dest_dir=tmpdir
            )

            ctx = _build_submit_context(
                application_id=application_id,
                apply_url=apply_url,
                profile_data=profile_data,
                resume_pdf_path=resume_pdf_path,
                cover_letter_text=cover_letter_text,
                form_payload=form_payload,
            )

            async def on_progress(ev: dict[str, Any]) -> None:
                phase = ev.get("phase", "progress")
                data = {k: v for k, v in ev.items() if k != "phase"}
                await emit_event(
                    sf, job_id, phase=phase, message=None, data=data
                )

            on_captcha_cb = None
            if mode == "A":
                on_captcha_cb = _make_captcha_handler(
                    sf, application_id=application_id
                )

            # Dispatch by ``posting.source``. If no deterministic adapter is
            # registered for this source — or the adapter explicitly raises
            # :class:`AdapterUnsupported` for this specific posting — fall
            # back to the browser-agent submitter. Agent fallback is B-mode
            # only this slice (Task 5 owns the implementation); an A-mode
            # application that hits the agent path is parked as
            # ``needs_attention`` so the user can review before it runs.
            adapter = ADAPTERS.get(posting.source)
            agent_result: agent_submit.AgentSubmitResult | None = None

            async def _run_agent_path() -> agent_submit.AgentSubmitResult:
                if mode == "A":
                    raise _NeedsAttention(
                        "agent fallback refuses A-mode; review and "
                        "confirm in B-mode"
                    )
                return await agent_submit.run(
                    ctx,
                    on_progress=on_progress,  # type: ignore[arg-type]
                )

            if adapter is None:
                await emit_event(
                    sf,
                    job_id,
                    phase="adapter_missing",
                    message=f"no adapter for source={posting.source!r}; "
                    "falling back to agent",
                    data={"source": posting.source},
                )
                agent_result = await _run_agent_path()
                result = None
            else:
                try:
                    result = await adapter.submit(
                        ctx,
                        on_progress=on_progress,  # type: ignore[arg-type]
                        on_captcha=on_captcha_cb,
                    )
                except AdapterUnsupported as exc:
                    await emit_event(
                        sf,
                        job_id,
                        phase="adapter_unsupported",
                        message=f"adapter unsupported: {exc}; "
                        "falling back to agent",
                        data={"source": posting.source},
                    )
                    agent_result = await _run_agent_path()
                    result = None

        # 5. Persist artifacts + flip terminal state.
        # Agent fallback that paused awaiting user confirmation: park the
        # row in ``awaiting_confirmation`` and surface artifacts so the
        # review queue can render the confirm card (Task 6). The runner
        # does NOT mark the row submitted — the user owns that step.
        if agent_result is not None and agent_result.get(
            "awaiting_user_confirmation"
        ):
            async with sf() as s:
                values: dict[str, Any] = {
                    "status": "awaiting_confirmation",
                    "confirmation_screenshot_path": agent_result.get(
                        "screenshot_path"
                    ),
                    "error": None,
                }
                # Best-effort: model fields added in Task 5 may not exist
                # yet on every branch. Set them dynamically via SQL builder
                # so this code path stays compatible with the pre-Task-5
                # schema.
                from app.models import Application as _App
                if hasattr(_App, "agent_session_id"):
                    values["agent_session_id"] = agent_result.get(
                        "agent_session_id"
                    )
                if hasattr(_App, "awaiting_user_confirmation"):
                    values["awaiting_user_confirmation"] = True
                await s.execute(
                    update(Application)
                    .where(Application.id == application_id)
                    .values(**values)
                )
                await s.execute(
                    update(Job)
                    .where(Job.id == job_id)
                    .values(
                        status="succeeded",
                        finished_at=datetime.now(timezone.utc),
                        result={
                            "application_id": application_id,
                            "awaiting_user_confirmation": True,
                            "form_summary": agent_result.get(
                                "form_summary", ""
                            ),
                        },
                    )
                )
                await s.commit()
            try:
                await emit_event(
                    sf,
                    job_id,
                    phase="awaiting_user_confirmation",
                    message="agent paused before final submit",
                    data={"application_id": application_id},
                )
            except Exception:  # noqa: BLE001
                logger.exception("emit awaiting_user_confirmation failed")
            return

        # Either a deterministic adapter completed, or the agent ran to
        # completion (Task 5 may eventually allow that for trusted forms).
        completion = result if result is not None else agent_result
        if completion is None:
            raise RuntimeError(
                "submit dispatch produced no result and no agent output"
            )
        confirmation_html = _truncate_confirmation(
            completion.get("confirmation_html", "") or ""
        )

        async with sf() as s:
            await s.execute(
                update(Application)
                .where(Application.id == application_id)
                .values(
                    status="submitted",
                    submitted_at=completion["submitted_at"],
                    confirmation_html=confirmation_html,
                    confirmation_screenshot_path=completion[
                        "confirmation_screenshot_path"
                    ],
                    error=None,
                )
            )
            await s.execute(
                update(JobPosting)
                .where(JobPosting.id == posting.id)
                .values(status="submitted")
            )
            await s.execute(
                update(Job)
                .where(Job.id == job_id)
                .values(
                    status="succeeded",
                    finished_at=datetime.now(timezone.utc),
                    result={
                        "application_id": application_id,
                        "submitted_at": completion["submitted_at"].isoformat(),
                        "screenshot_path": completion[
                            "confirmation_screenshot_path"
                        ],
                        "via": "agent" if agent_result is not None else "adapter",
                    },
                )
            )
            await s.commit()

        try:
            await emit_event(
                sf,
                job_id,
                phase="done",
                message=None,
                data={"application_id": application_id},
            )
        except Exception:  # noqa: BLE001
            logger.exception("emit done event failed for job %s", job_id)

    except _NeedsAttention as exc:
        # Agent path was taken in A-mode; this slice forbids that. Park the
        # row so the user can flip mode or re-target. Job is succeeded-with-
        # skip — this is policy enforcement, not a failure.
        if application_id is not None:
            try:
                async with sf() as s:
                    await s.execute(
                        update(Application)
                        .where(Application.id == application_id)
                        .values(
                            status="needs_attention",
                            error=str(exc)[:500],
                        )
                    )
                    await s.commit()
            except Exception:  # noqa: BLE001
                logger.exception(
                    "failed to mark application %s needs_attention",
                    application_id,
                )
        try:
            async with sf() as s:
                await s.execute(
                    update(Job)
                    .where(Job.id == job_id)
                    .values(
                        status="succeeded",
                        finished_at=datetime.now(timezone.utc),
                        result={
                            "application_id": application_id,
                            "skipped": True,
                            "reason": "needs_attention",
                            "detail": str(exc)[:200],
                        },
                    )
                )
                await s.commit()
            await emit_event(
                sf,
                job_id,
                phase="needs_attention",
                message=str(exc)[:200],
                data={"application_id": application_id},
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "needs_attention handler failed for job %s", job_id
            )

    except greenhouse_submit.CaptchaPauseRequired as exc:
        # Captcha handler already persisted the screenshot + notification +
        # set status='captcha_pause'. Mark the job succeeded-with-skip so
        # the operator queue doesn't fill with spurious failed jobs.
        try:
            async with sf() as s:
                await s.execute(
                    update(Job)
                    .where(Job.id == job_id)
                    .values(
                        status="succeeded",
                        finished_at=datetime.now(timezone.utc),
                        result={
                            "application_id": application_id,
                            "skipped": True,
                            "reason": "captcha_pause",
                            "url": (exc.ctx or {}).get("url", ""),
                        },
                    )
                )
                await s.commit()
            await emit_event(
                sf,
                job_id,
                phase="captcha_pause",
                message="captcha challenge encountered",
                data={"application_id": application_id},
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "terminal captcha-pause handler failed for job %s", job_id
            )

    except greenhouse_submit.MissingFieldError as exc:
        await _fail_application(
            sf,
            application_id=application_id,
            job_id=job_id,
            error=f"missing field: {exc.field}",
        )

    except greenhouse_submit.ConfirmationTimeoutError as exc:
        # The submit click MAY have succeeded server-side. Persist the
        # captured artifacts so a human can verify in the review queue,
        # but mark the row as errored with a descriptive message.
        error_msg = (
            "confirmation timeout (submit may have succeeded — "
            f"verify manually): url={exc.url} title={exc.title}"
        )
        if application_id is not None:
            try:
                async with sf() as s:
                    await s.execute(
                        update(Application)
                        .where(Application.id == application_id)
                        .values(
                            status="errored",
                            error=error_msg[:500],
                            confirmation_html=_truncate_confirmation(
                                exc.confirmation_html or ""
                            ),
                            confirmation_screenshot_path=exc.screenshot_path,
                        )
                    )
                    await s.commit()
            except Exception:  # noqa: BLE001
                logger.exception(
                    "failed to persist confirmation-timeout artifacts "
                    "for application %s",
                    application_id,
                )
        try:
            async with sf() as s:
                await s.execute(
                    update(Job)
                    .where(Job.id == job_id)
                    .values(
                        status="failed",
                        finished_at=datetime.now(timezone.utc),
                        result={"error": error_msg[:500]},
                    )
                )
                await s.commit()
            await emit_event(
                sf,
                job_id,
                phase="failed",
                message=error_msg[:500],
                data={"error": error_msg[:500]},
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "terminal failure handler failed for job %s", job_id
            )

    except Exception as exc:  # noqa: BLE001 — terminal catch-all per spec
        await _fail_application(
            sf,
            application_id=application_id,
            job_id=job_id,
            error=str(exc)[:500],
        )

    finally:
        hb.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await hb


async def _fail_application(
    sf: SessionFactory,
    *,
    application_id: int | None,
    job_id: uuid.UUID,
    error: str,
) -> None:
    """Flip Application -> errored and Job -> failed; emit a failed event.

    Each step runs in its own session and swallows secondary exceptions so
    a transient DB blip on the failure path doesn't mask the original
    error.
    """
    if application_id is not None:
        try:
            async with sf() as s:
                await s.execute(
                    update(Application)
                    .where(Application.id == application_id)
                    .values(status="errored", error=error[:500])
                )
                await s.commit()
        except Exception:  # noqa: BLE001
            logger.exception(
                "failed to mark application %s as errored", application_id
            )
    try:
        async with sf() as s:
            await s.execute(
                update(Job)
                .where(Job.id == job_id)
                .values(
                    status="failed",
                    finished_at=datetime.now(timezone.utc),
                    result={"error": error[:500]},
                )
            )
            await s.commit()
        await emit_event(
            sf,
            job_id,
            phase="failed",
            message=error[:500],
            data={"error": error[:500]},
        )
    except Exception:  # noqa: BLE001
        logger.exception(
            "terminal failure handler failed for job %s", job_id
        )


# Dispatch table mapping job ``kind`` -> async runner. New runners (slice 2+)
# register themselves here so the worker supervisor stays kind-agnostic.
# NOTE: tests must use monkeypatch.setitem(RUNNERS, kind, fake), not
# monkeypatch.setattr on the module-level callable — the dict captures
# the function reference at import time, so patching the bound name
# does not update what gets dispatched.
RUNNERS: dict[str, Callable[[SessionFactory, uuid.UUID], Awaitable[None]]] = {
    "tailor": run_tailor_job,
    "ingest_source": run_ingest_source_job,
    # Slice-4 Batch A compat: scheduler still enqueues this kind until
    # Batch B Task 8 teaches it to use ingest_source. Drop in slice 5.
    "ingest_greenhouse": run_ingest_greenhouse_job,
    "ingest_gmail": run_ingest_gmail_job,
    "classify_posting": run_classify_posting_job,
    "prepare_application": run_prepare_application_job,
    "submit_application": run_submit_application_job,
}


# Slice-5 Task 11 — agentic company discovery. Distinct runner module
# from the rest of the file because it has no posting/application
# coupling; it just talks to the discovery agent and inserts companies.
async def run_discover_companies_job(
    sf: SessionFactory, job_id: uuid.UUID
) -> None:
    """Execute a queued ``discover_companies`` job.

    Reads the user's profile + the existing companies allowlist, calls
    the discovery agent, validates each proposal by hitting the matching
    source's ``fetch_company_postings``, and inserts verified proposals
    into ``companies`` with ``enabled=False`` and
    ``discovered_by="agent"``. Duplicate ``(slug, source)`` pairs are
    silently dropped so we never overwrite a row the user has already
    enabled or modified.
    """
    async with sf() as s:
        profile_row = (
            await s.execute(select(ProfileModel).where(ProfileModel.user_id == 1))
        ).scalar_one_or_none()
        profile = profile_row.data if profile_row is not None else {}
        existing_rows = (
            await s.execute(select(Company))
        ).scalars().all()
        existing = [
            {
                "slug": r.slug,
                "source": r.source,
                "display_name": r.display_name,
                "enabled": r.enabled,
            }
            for r in existing_rows
        ]
        existing_keys = {(r.source, r.slug) for r in existing_rows}

    await emit_event(sf, job_id, phase="discover_start", message="agent", data={})
    envelope = await agent_discover.propose_companies(
        profile=profile, existing=existing
    )
    proposals = envelope.get("proposals") or []

    inserted = 0
    skipped_invalid = 0
    skipped_dup = 0
    async with httpx.AsyncClient(timeout=15.0) as http:
        for p in proposals:
            if not isinstance(p, dict):
                skipped_invalid += 1
                continue
            source = (p.get("source") or "").strip()
            slug = (p.get("slug") or "").strip()
            display = (p.get("display_name") or "").strip() or slug
            rationale = p.get("rationale") or None
            if not source or not slug or source not in SOURCES:
                skipped_invalid += 1
                continue
            if (source, slug) in existing_keys:
                skipped_dup += 1
                continue
            adapter = SOURCES[source]
            try:
                postings = await adapter.fetch_company_postings(
                    slug, http=http
                )
            except TypeError:
                # Playwright-only adapters don't accept ``http=``; skip
                # the validation fetch and trust the agent for those.
                postings = [None]
            except Exception:
                logger.exception(
                    "discover: validation fetch failed for %s/%s",
                    source,
                    slug,
                )
                skipped_invalid += 1
                continue
            if not postings:
                skipped_invalid += 1
                continue
            async with sf() as s:
                s.add(
                    Company(
                        slug=slug,
                        display_name=display,
                        source=source,
                        enabled=False,
                        discovered_by="agent",
                        discovery_rationale=rationale,
                    )
                )
                try:
                    await s.commit()
                    inserted += 1
                    existing_keys.add((source, slug))
                except IntegrityError:
                    await s.rollback()
                    skipped_dup += 1

    await emit_event(
        sf,
        job_id,
        phase="discover_done",
        message=f"inserted={inserted} dup={skipped_dup} invalid={skipped_invalid}",
        data={
            "inserted": inserted,
            "skipped_dup": skipped_dup,
            "skipped_invalid": skipped_invalid,
        },
    )


RUNNERS["discover_companies"] = run_discover_companies_job


# Slice-5 Task 12 — dream-tier research. After classify writes
# tier="dream" the runner enqueues this job for the freshly-prepared
# application; we persist a structured brief to ``application_research``
# (one row per application, idempotent on repeat runs).
async def run_dream_research_job(
    sf: SessionFactory, job_id: uuid.UUID
) -> None:
    """Execute a queued ``dream_research`` job.

    Reads ``payload['application_id']``, gathers posting + company +
    profile context, runs the dream-research agent, and upserts the
    result into ``application_research`` keyed by ``application_id``.
    """
    async with sf() as s:
        job = (
            await s.execute(select(Job).where(Job.id == job_id))
        ).scalar_one()
        application_id = int((job.payload or {}).get("application_id") or 0)
        if not application_id:
            return
        app = (
            await s.execute(
                select(Application).where(Application.id == application_id)
            )
        ).scalar_one_or_none()
        if app is None:
            return
        posting = (
            await s.execute(
                select(JobPosting).where(JobPosting.id == app.posting_id)
            )
        ).scalar_one_or_none()
        if posting is None:
            return
        company = None
        if posting.company_id is not None:
            company = (
                await s.execute(
                    select(Company).where(Company.id == posting.company_id)
                )
            ).scalar_one_or_none()
        profile_row = (
            await s.execute(select(ProfileModel).where(ProfileModel.user_id == 1))
        ).scalar_one_or_none()
        profile = profile_row.data if profile_row is not None else {}

        posting_payload = {
            "title": posting.title,
            "location": posting.location,
            "description_text": posting.description_text,
            "tier": posting.tier,
            "apply_url": posting.apply_url,
        }
        company_payload = (
            {
                "slug": company.slug,
                "display_name": company.display_name,
                "source": company.source,
            }
            if company is not None
            else {}
        )

    await emit_event(sf, job_id, phase="research_start", message="agent", data={})
    out = await agent_dream.research_company(
        posting=posting_payload, company=company_payload, profile=profile
    )

    brief = (out.get("brief_md") or "").strip()
    signals = out.get("signals") or {}
    if not isinstance(signals, dict):
        signals = {}
    if not brief:
        # Don't persist a useless empty brief.
        await emit_event(
            sf, job_id, phase="research_done", message="empty", data={}
        )
        return

    async with sf() as s:
        existing = (
            await s.execute(
                select(ApplicationResearch).where(
                    ApplicationResearch.application_id == application_id
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            s.add(
                ApplicationResearch(
                    application_id=application_id,
                    brief_md=brief,
                    signals_json=signals,
                    model=agent_dream.model_name(deep=False),
                )
            )
        else:
            existing.brief_md = brief
            existing.signals_json = signals
            existing.model = agent_dream.model_name(deep=False)
        await s.commit()

    await emit_event(
        sf,
        job_id,
        phase="research_done",
        message=f"persisted application_id={application_id}",
        data={"application_id": application_id},
    )


RUNNERS["dream_research"] = run_dream_research_job


# Slice-5 Task 13 — Notion KB sync. Walks the configured page ids
# (from ``NOTION_PAGE_IDS`` env, comma-separated) and upserts each into
# ``kb_documents`` under ``source="notion"``. Pages no longer in the
# configured set are purged on the next sync.
async def run_kb_sync_notion(
    sf: SessionFactory, job_id: uuid.UUID
) -> None:
    """Execute a queued ``kb_sync_notion`` job."""
    from app.services.kb_sources import notion as notion_kb

    await emit_event(sf, job_id, phase="kb_sync_start", message="notion", data={})
    try:
        async with sf() as s:
            result = await notion_kb.ingest(
                user_id=1, db=s, page_ids=notion_kb.page_ids_from_env()
            )
        async with sf() as s:
            await s.execute(
                update(Job)
                .where(Job.id == job_id)
                .values(
                    status="succeeded",
                    finished_at=datetime.now(timezone.utc),
                    result={"source": "notion", **result},
                )
            )
            await s.commit()
        await emit_event(
            sf, job_id, phase="kb_sync_done", message="notion", data=result
        )
    except Exception as exc:  # noqa: BLE001
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


RUNNERS["kb_sync_notion"] = run_kb_sync_notion
