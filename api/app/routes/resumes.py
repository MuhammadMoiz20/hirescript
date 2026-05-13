import json
import os

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select, delete as sa_delete, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timezone
from app.auth import require_user
from app.db import SessionLocal, get_db
from app.models import Job, Resume, JobDescription, ResumeVersion
from app.schemas import (
    ResumeCreate,
    ResumeUpdate,
    ResumeOut,
    ResumeGroup,
    VariantOut,
    EditRequest,
    EditAcceptRequest,
    SectionsResponse,
    SectionsPutRequest,
    TailorRequest,
    TailorResponse,
    OnboardTexRequest,
    OnboardedResumeOut,
    JobDescriptionOut,
)
from app.services.agent import edit_resume, AgentError
from app.services.compile import compile_latex, CompileError
from app.services.enforcer import enforce_one_page
from app.services.onboard import onboard_from_pdf, onboard_from_latex
from app.services.parser_jakes import parse_jakes
from app.services.protected_terms import resolve_protected_terms
from app.services.renderer_jakes import render_jakes
from app.services import jobs_runner
from app.services.versioning import snapshot_resume_version
from app.templates import get_template
from app.templates.jakes_schema import get_section_schema

router = APIRouter(prefix="/resumes")

@router.post("", response_model=ResumeOut, status_code=201)
async def create_resume(body: ResumeCreate, user_id: int = Depends(require_user), db: AsyncSession = Depends(get_db)):
    try:
        tpl = get_template(body.template_id)
    except KeyError:
        raise HTTPException(404, "unknown template")
    resume = Resume(user_id=user_id, kind="master", name=body.name, template_id=body.template_id, latex_source=tpl["latex_skeleton"], one_line_per_bullet=body.one_line_per_bullet)
    db.add(resume)
    await db.commit()
    await db.refresh(resume)
    return resume

@router.get("", response_model=list[ResumeOut])
async def list_resumes(user_id: int = Depends(require_user), db: AsyncSession = Depends(get_db)):
    rows = await db.execute(select(Resume).where(Resume.user_id == user_id).order_by(Resume.updated_at.desc()))
    return rows.scalars().all()

@router.get("/grouped", response_model=list[ResumeGroup])
async def list_grouped(user_id: int = Depends(require_user), db: AsyncSession = Depends(get_db)):
    masters = (await db.execute(
        select(Resume).where(Resume.user_id == user_id, Resume.kind == "master")
        .order_by(Resume.updated_at.desc())
    )).scalars().all()
    if not masters:
        return []

    master_ids = [m.id for m in masters]
    variants = (await db.execute(
        select(Resume).where(Resume.user_id == user_id, Resume.kind == "variant",
                             Resume.parent_id.in_(master_ids))
        .order_by(Resume.updated_at.desc())
    )).scalars().all()

    jd_ids = [v.job_description_id for v in variants if v.job_description_id is not None]
    jd_map: dict[int, JobDescription] = {}
    if jd_ids:
        jds = (await db.execute(
            select(JobDescription).where(JobDescription.id.in_(jd_ids))
        )).scalars().all()
        jd_map = {j.id: j for j in jds}

    groups: list[ResumeGroup] = []
    for m in masters:
        ms_variants = [v for v in variants if v.parent_id == m.id]
        out_variants = []
        for v in ms_variants:
            jd = jd_map.get(v.job_description_id) if v.job_description_id else None
            data = {
                **{k: getattr(v, k) for k in ("id","name","template_id","kind","latex_source","updated_at","parent_id","job_description_id","one_line_per_bullet")},
                "jd_title": jd.title if jd else None,
                "jd_company": jd.company if jd else None,
            }
            out_variants.append(VariantOut.model_validate(data))
        groups.append(ResumeGroup(master=ResumeOut.model_validate(m), variants=out_variants))
    return groups

@router.post("/onboard/tex", response_model=OnboardedResumeOut)
async def onboard_tex(
    body: OnboardTexRequest,
    response: Response,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await onboard_from_latex(
            latex=body.latex_source,
            one_line_per_bullet=body.one_line_per_bullet,
        )
    except CompileError as e:
        raise HTTPException(422, detail={"error": "compile_failed", "log": str(e)[:4000]})
    resume = Resume(
        user_id=user_id,
        kind="master",
        template_id="jakes",
        name=body.name,
        latex_source=result.latex_source,
        content_json=result.content_json,
        one_line_per_bullet=body.one_line_per_bullet,
    )
    db.add(resume)
    await db.flush()
    await snapshot_resume_version(
        db=db,
        resume=resume,
        page_count=result.page_count,
        edit_source="onboard",
        edit_prompt=None,
        pdf_bytes=result.pdf,
    )
    await db.commit()
    await db.refresh(resume)
    response.headers["X-Page-Count"] = str(result.page_count)
    return OnboardedResumeOut(
        **{k: getattr(resume, k) for k in ("id", "name", "template_id", "kind", "latex_source", "updated_at", "one_line_per_bullet")},
        enforced=result.enforced,
        iterations=result.iterations,
        page_count=result.page_count,
    )


@router.post("/onboard/pdf", response_model=OnboardedResumeOut)
async def onboard_pdf(
    response: Response,
    name: str = Form(...),
    one_line_per_bullet: bool = Form(False),
    file: UploadFile = File(...),
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    pdf_bytes = await file.read()
    if not pdf_bytes or pdf_bytes[:4] != b"%PDF":
        raise HTTPException(400, detail={"error": "not_a_pdf"})
    try:
        result = await onboard_from_pdf(
            pdf_bytes=pdf_bytes,
            one_line_per_bullet=one_line_per_bullet,
        )
    except CompileError as e:
        raise HTTPException(422, detail={"error": "compile_failed", "log": str(e)[:4000]})
    resume = Resume(
        user_id=user_id,
        kind="master",
        template_id="jakes",
        name=name,
        latex_source=result.latex_source,
        content_json=result.content_json,
        one_line_per_bullet=one_line_per_bullet,
    )
    db.add(resume)
    await db.flush()
    await snapshot_resume_version(
        db=db,
        resume=resume,
        page_count=result.page_count,
        edit_source="onboard",
        edit_prompt=None,
        pdf_bytes=result.pdf,
    )
    await db.commit()
    await db.refresh(resume)
    response.headers["X-Page-Count"] = str(result.page_count)
    return OnboardedResumeOut(
        **{k: getattr(resume, k) for k in ("id", "name", "template_id", "kind", "latex_source", "updated_at", "one_line_per_bullet")},
        enforced=result.enforced,
        iterations=result.iterations,
        page_count=result.page_count,
    )


@router.get("/{resume_id}", response_model=ResumeOut)
async def get_resume(resume_id: int, user_id: int = Depends(require_user), db: AsyncSession = Depends(get_db)):
    r = await db.get(Resume, resume_id)
    if r is None or r.user_id != user_id:
        raise HTTPException(404)
    return r

@router.put("/{resume_id}", response_model=ResumeOut)
async def update_resume(resume_id: int, body: ResumeUpdate, user_id: int = Depends(require_user), db: AsyncSession = Depends(get_db)):
    r = await db.get(Resume, resume_id)
    if r is None or r.user_id != user_id:
        raise HTTPException(404)
    if body.name is not None:
        r.name = body.name
    latex_changed = body.latex_source is not None
    if latex_changed:
        r.latex_source = body.latex_source
    if latex_changed:
        await snapshot_resume_version(
            db=db,
            resume=r,
            page_count=0,
            edit_source="manual",
            edit_prompt=None,
        )
    await db.commit()
    await db.refresh(r)
    return r

@router.delete("/{resume_id}", status_code=204)
async def delete_resume(
    resume_id: int,
    promote: int | None = Query(None),
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    r = await db.get(Resume, resume_id)
    if r is None or r.user_id != user_id:
        raise HTTPException(404)

    if r.kind == "master":
        variants = (await db.execute(
            select(Resume).where(Resume.parent_id == r.id, Resume.user_id == user_id)
        )).scalars().all()
        if variants:
            variant_ids = [v.id for v in variants]
            if promote is None or promote not in variant_ids:
                raise HTTPException(
                    400,
                    detail={
                        "error": "promote_required",
                        "message": "Master has variants; pick one to promote.",
                        "variant_ids": variant_ids,
                    },
                )
            new_master = next(v for v in variants if v.id == promote)
            new_master.kind = "master"
            new_master.parent_id = None
            for v in variants:
                if v.id != new_master.id:
                    v.parent_id = new_master.id
            await db.flush()

    await db.execute(sa_delete(ResumeVersion).where(ResumeVersion.resume_id == r.id))
    await db.delete(r)
    await db.commit()
    return Response(status_code=204)


@router.post("/{resume_id}/duplicate", response_model=ResumeOut, status_code=201)
async def duplicate_resume(
    resume_id: int,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    r = await db.get(Resume, resume_id)
    if r is None or r.user_id != user_id:
        raise HTTPException(404)
    copy = Resume(
        user_id=user_id,
        kind="master",
        parent_id=None,
        job_description_id=None,
        name=f"{r.name} (copy)",
        template_id=r.template_id,
        latex_source=r.latex_source,
        content_json=r.content_json,
        protected_terms=list(r.protected_terms or []),
    )
    db.add(copy)
    await db.commit()
    await db.refresh(copy)
    return copy


@router.post("/{resume_id}/compile")
async def compile_resume(resume_id: int, user_id: int = Depends(require_user), db: AsyncSession = Depends(get_db)):
    r = await db.get(Resume, resume_id)
    if r is None or r.user_id != user_id:
        raise HTTPException(404)
    try:
        result = compile_latex(r.latex_source)
    except CompileError as e:
        raise HTTPException(422, detail={"error": "compile_failed", "log": str(e)[:4000]})
    return Response(
        content=result.pdf,
        media_type="application/pdf",
        headers={
            "X-Page-Count": str(result.page_count),
            "X-Overflow-Count": str(len(result.overflows)),
        },
    )


@router.post("/{resume_id}/repair")
async def repair_resume(
    resume_id: int,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Run the OnePageEnforcer on the saved LaTeX. Returns the repaired
    source and metadata; does NOT persist — the caller decides whether to
    accept by calling PUT /resumes/{id}. This mirrors how AI chat edits flow:
    propose → user reviews → user accepts."""
    r = await db.get(Resume, resume_id)
    if r is None or r.user_id != user_id:
        raise HTTPException(404)
    protected = resolve_protected_terms(user_pinned=r.protected_terms or [])
    try:
        result = await enforce_one_page(
            candidate_latex=r.latex_source,
            protected_terms=protected,
            detect_wraps=r.one_line_per_bullet,
        )
    except CompileError as e:
        raise HTTPException(422, detail={"error": "compile_failed", "log": str(e)[:4000]})
    return {
        "latex_source": result.latex,
        "page_count": result.page_count,
        "overflow_count": len(result.overflows),
        "enforced": result.enforced,
        "iterations": result.iterations,
        "tier_history": result.tier_history,
    }


@router.post("/{resume_id}/enforce_one_line", response_model=ResumeOut, status_code=201)
async def enforce_one_line(
    resume_id: int,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Run wrap-aware enforcement on a resume and save the result as a new
    sibling row with ``one_line_per_bullet=True``. The source is unchanged.

    - If the source is a master, the sibling is an independent master
      (``parent_id=None``).
    - If the source is a variant, the sibling sits under the same master
      (``parent_id=src.parent_id``) and inherits ``job_description_id``.
    """
    src = await db.get(Resume, resume_id)
    if src is None or src.user_id != user_id:
        raise HTTPException(404)
    protected = resolve_protected_terms(user_pinned=src.protected_terms or [])
    try:
        result = await enforce_one_page(
            candidate_latex=src.latex_source,
            protected_terms=protected,
            detect_wraps=True,
        )
    except CompileError as e:
        raise HTTPException(
            422, detail={"error": "compile_failed", "log": str(e)[:4000]}
        )
    if src.kind == "master":
        new_parent_id = None
        new_jd_id = None
    else:
        new_parent_id = src.parent_id
        new_jd_id = src.job_description_id
    sibling = Resume(
        user_id=user_id,
        parent_id=new_parent_id,
        job_description_id=new_jd_id,
        kind=src.kind,
        name=f"{src.name} (one-line)",
        template_id=src.template_id,
        latex_source=result.latex,
        content_json=src.content_json,
        protected_terms=list(src.protected_terms or []),
        one_line_per_bullet=True,
    )
    db.add(sibling)
    await db.flush()
    await snapshot_resume_version(
        db=db,
        resume=sibling,
        page_count=result.page_count,
        edit_source="enforce_one_line",
        edit_prompt=None,
        pdf_bytes=result.pdf,
    )
    await db.commit()
    await db.refresh(sibling)
    return sibling


@router.post("/{resume_id}/edits")
async def propose_edit(
    resume_id: int,
    body: EditRequest,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    resume = await db.get(Resume, resume_id)
    if resume is None or resume.user_id != user_id:
        raise HTTPException(404)

    protected = resolve_protected_terms(user_pinned=resume.protected_terms or [])
    # Prefer the editor's in-memory latex when the client provides it so that
    # unsaved edits are reflected. Falls back to the DB-stored source.
    latex_source = body.current_latex if body.current_latex else resume.latex_source

    try:
        current = compile_latex(latex_source)
        page_hint = current.page_count
    except CompileError:
        page_hint = 0

    instruction = body.instruction
    tier = body.tier
    history = [(t.role, t.content) for t in body.history]

    async def event_stream():
        import re
        from app.services.agent import _extract_json_object
        collected: list[str] = []
        try:
            async for chunk in edit_resume(
                current_latex=latex_source,
                instruction=instruction,
                protected_terms=protected,
                page_count_hint=page_hint,
                tier=tier,
                history=history,
            ):
                collected.append(chunk)
                yield f"event: chunk\ndata: {json.dumps({'text': chunk})}\n\n"

            full = "".join(collected)

            envelope: dict | None = None
            # 1. Preferred: ```json fenced block.
            match = re.search(r"```json\s*(\{.*?\})\s*```", full, re.DOTALL)
            if match:
                try:
                    parsed = json.loads(match.group(1))
                    if isinstance(parsed, dict) and isinstance(parsed.get("latex"), str):
                        envelope = parsed
                except json.JSONDecodeError:
                    pass
            # 2. Fallback: shared extractor handles bare/prose-wrapped JSON.
            if envelope is None:
                candidate = _extract_json_object(full)
                if candidate.startswith("{"):
                    try:
                        parsed = json.loads(candidate)
                        if isinstance(parsed, dict) and isinstance(parsed.get("latex"), str):
                            envelope = parsed
                    except json.JSONDecodeError:
                        pass

            if envelope is None:
                # Conversational reply only — no edit to apply.
                payload = {
                    "proposed_latex": None,
                    "page_count": page_hint,
                    "enforced": True,
                    "iterations": 0,
                    "tier_history": [],
                    "removed_terms": [],
                    "kind": "chat",
                }
                yield f"event: result\ndata: {json.dumps(payload)}\n\n"
                return

            candidate = envelope["latex"]
            result = await enforce_one_page(
                candidate_latex=candidate,
                protected_terms=protected,
            )
            payload = {
                "proposed_latex": result.latex,
                "page_count": result.page_count,
                "enforced": result.enforced,
                "iterations": result.iterations,
                "tier_history": result.tier_history,
                "removed_terms": [],
                "kind": "edit",
            }
            yield f"event: result\ndata: {json.dumps(payload)}\n\n"
        except AgentError as exc:
            yield f"event: error\ndata: {json.dumps({'message': str(exc)[:500]})}\n\n"
        except Exception as exc:  # pragma: no cover - defensive
            yield f"event: error\ndata: {json.dumps({'message': str(exc)[:500]})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/{resume_id}/edits/accept")
async def accept_edit(
    resume_id: int,
    body: EditAcceptRequest,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    resume = await db.get(Resume, resume_id)
    if resume is None or resume.user_id != user_id:
        raise HTTPException(404)
    try:
        compiled = compile_latex(body.proposed_latex)
    except CompileError as e:
        raise HTTPException(
            422, detail={"error": "compile_failed", "log": str(e)[:4000]}
        )
    # One-page invariant applies to variants (the deliverable). Masters are
    # the user's working source — they can grow past one page in progress and
    # the page-count gate would be in the way.
    if resume.kind != "master" and compiled.page_count != 1:
        raise HTTPException(
            422,
            detail={"error": "not_one_page", "page_count": compiled.page_count},
        )
    resume.latex_source = body.proposed_latex
    await snapshot_resume_version(
        db=db,
        resume=resume,
        page_count=compiled.page_count,
        edit_source="ai_chat",
        edit_prompt=None,
        pdf_bytes=compiled.pdf,
    )
    await db.commit()
    await db.refresh(resume)
    payload = ResumeOut.model_validate(resume, from_attributes=True).model_dump(mode="json")
    return Response(
        content=json.dumps(payload),
        media_type="application/json",
        headers={"X-Page-Count": str(compiled.page_count)},
    )


@router.get("/{resume_id}/sections", response_model=SectionsResponse)
async def get_sections(
    resume_id: int,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    r = await db.get(Resume, resume_id)
    if r is None or r.user_id != user_id:
        raise HTTPException(404)
    if r.template_id != "jakes":
        raise HTTPException(
            400,
            detail={"error": "unsupported_template", "template_id": r.template_id},
        )
    if not r.content_json:
        parsed = parse_jakes(r.latex_source)
        r.content_json = parsed
        await db.commit()
        await db.refresh(r)
    return SectionsResponse(
        template_id=r.template_id,
        schema=get_section_schema(r.template_id),
        content_json=r.content_json,
    )


@router.put("/{resume_id}/sections", response_model=ResumeOut)
async def put_sections(
    resume_id: int,
    body: SectionsPutRequest,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    r = await db.get(Resume, resume_id)
    if r is None or r.user_id != user_id:
        raise HTTPException(404)
    if r.template_id != "jakes":
        raise HTTPException(400, detail={"error": "unsupported_template"})
    rendered = render_jakes(body.content_json)
    try:
        compiled = compile_latex(rendered)
    except CompileError as e:
        raise HTTPException(
            422, detail={"error": "compile_failed", "log": str(e)[:4000]}
        )
    # Variants must stay at one page; masters are working sources and may
    # exceed it while the user is editing.
    if r.kind != "master" and compiled.page_count != 1:
        raise HTTPException(
            422,
            detail={"error": "not_one_page", "page_count": compiled.page_count},
        )
    r.latex_source = rendered
    r.content_json = body.content_json
    await snapshot_resume_version(
        db=db,
        resume=r,
        page_count=compiled.page_count,
        edit_source="section_form",
        edit_prompt=None,
        pdf_bytes=compiled.pdf,
    )
    await db.commit()
    await db.refresh(r)
    return r


@router.post("/{master_id}/tailor")
async def tailor_endpoint(
    master_id: int,
    body: TailorRequest,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Enqueue a tailor job for ``master_id`` against the given JD.

    Production: enqueues a single-job batch on the queue and returns
    ``{"job_id", "batch_id"}``; the worker container picks it up and the
    client streams progress from ``/api/jobs/{job_id}/events``.

    Tests / dev (``JOBS_INLINE=1``): enqueues, then claims and runs the
    job synchronously in-process via ``jobs_runner.run_tailor_job``. On
    success the route returns the legacy ``TailorResponse`` JSON shape
    (variant + jd_id + page_count etc.) so existing callers keep working.
    """
    master = await db.get(Resume, master_id)
    if master is None or master.user_id != user_id:
        raise HTTPException(404)
    if master.kind != "master":
        raise HTTPException(400, detail={"error": "not_a_master_resume"})

    job = Job(
        kind="tailor",
        status="queued",
        payload={
            "resume_id": master.id,
            "jd_text": body.jd_text,
            "title": body.title,
            "company": body.company,
            "url": body.url,
            "deep": body.deep_tailor,
            "one_line_per_bullet": body.one_line_per_bullet,
        },
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    if os.environ.get("JOBS_INLINE") != "1":
        # Production: hand off to the worker container.
        return {"job_id": str(job.id), "batch_id": None}

    # Inline mode: claim the row in-process and run the runner synchronously.
    await db.execute(
        sa_update(Job)
        .where(Job.id == job.id)
        .values(
            status="running",
            worker_id="inline",
            started_at=datetime.now(timezone.utc),
            heartbeat_at=datetime.now(timezone.utc),
        )
    )
    await db.commit()

    await jobs_runner.run_tailor_job(SessionLocal, job.id)

    # Reload the terminal row with a fresh session — `db` may have stale state.
    async with SessionLocal() as s:
        finished = (
            await s.execute(select(Job).where(Job.id == job.id))
        ).scalar_one()
        status = finished.status
        result = finished.result or {}

        if status == "failed":
            if result.get("error") == "not_one_page":
                raise HTTPException(
                    422,
                    detail={
                        "error": "not_one_page",
                        "page_count": result.get("page_count", 0),
                        "iterations": result.get("iterations", 0),
                    },
                )
            raise HTTPException(
                500, detail={"error": result.get("error", "tailor_failed")}
            )
        if status == "cancelled":
            raise HTTPException(409, detail={"error": "cancelled"})
        if status != "succeeded":
            raise HTTPException(
                500, detail={"error": "tailor_did_not_complete", "status": status}
            )

        variant = (
            await s.execute(select(Resume).where(Resume.id == result["variant_id"]))
        ).scalar_one()

        return TailorResponse(
            variant=ResumeOut.model_validate(variant),
            jd_id=result["jd_id"],
            page_count=result["page_count"],
            iterations=result["iterations"],
            enforced=result["enforced"],
            tier_history=result["tier_history"],
            keywords_used=result["keywords_used"],
        )
