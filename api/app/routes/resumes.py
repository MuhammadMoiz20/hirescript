import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import require_user
from app.db import get_db
from app.models import Resume, JobDescription
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
)
from app.services.agent import edit_resume, AgentError
from app.services.compile import compile_latex, CompileError
from app.services.enforcer import enforce_one_page
from app.services.parser_jakes import parse_jakes
from app.services.protected_terms import resolve_protected_terms
from app.services.renderer_jakes import render_jakes
from app.services.tailor import tailor_resume, TailorResult
from app.templates import get_template
from app.templates.jakes_schema import get_section_schema

router = APIRouter(prefix="/resumes")

@router.post("", response_model=ResumeOut, status_code=201)
async def create_resume(body: ResumeCreate, user_id: int = Depends(require_user), db: AsyncSession = Depends(get_db)):
    try:
        tpl = get_template(body.template_id)
    except KeyError:
        raise HTTPException(404, "unknown template")
    resume = Resume(user_id=user_id, kind="master", name=body.name, template_id=body.template_id, latex_source=tpl["latex_skeleton"])
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
                **{k: getattr(v, k) for k in ("id","name","template_id","kind","latex_source","updated_at","parent_id","job_description_id")},
                "jd_title": jd.title if jd else None,
                "jd_company": jd.company if jd else None,
            }
            out_variants.append(VariantOut.model_validate(data))
        groups.append(ResumeGroup(master=ResumeOut.model_validate(m), variants=out_variants))
    return groups

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
    if body.latex_source is not None:
        r.latex_source = body.latex_source
    await db.commit()
    await db.refresh(r)
    return r

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
        headers={"X-Page-Count": str(result.page_count)},
    )


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
    latex_source = resume.latex_source

    try:
        current = compile_latex(latex_source)
        page_hint = current.page_count
    except CompileError:
        page_hint = 0

    instruction = body.instruction
    tier = body.tier

    async def event_stream():
        collected: list[str] = []
        try:
            async for chunk in edit_resume(
                current_latex=latex_source,
                instruction=instruction,
                protected_terms=protected,
                page_count_hint=page_hint,
                tier=tier,
            ):
                collected.append(chunk)
                yield f"event: chunk\ndata: {json.dumps({'text': chunk})}\n\n"

            proposed = "".join(collected).strip()
            if proposed.startswith("```"):
                proposed = "\n".join(
                    line for line in proposed.splitlines() if not line.startswith("```")
                )

            result = await enforce_one_page(
                candidate_latex=proposed,
                protected_terms=protected,
            )
            payload = {
                "proposed_latex": result.latex,
                "page_count": result.page_count,
                "enforced": result.enforced,
                "iterations": result.iterations,
                "tier_history": result.tier_history,
                "removed_terms": [],
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
    if compiled.page_count != 1:
        raise HTTPException(
            422,
            detail={"error": "not_one_page", "page_count": compiled.page_count},
        )
    resume.latex_source = body.proposed_latex
    await db.commit()
    await db.refresh(resume)
    payload = ResumeOut.model_validate(resume, from_attributes=True).model_dump(mode="json")
    return Response(
        content=json.dumps(payload),
        media_type="application/json",
        headers={"X-Page-Count": "1"},
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
    if compiled.page_count != 1:
        raise HTTPException(
            422,
            detail={"error": "not_one_page", "page_count": compiled.page_count},
        )
    r.latex_source = rendered
    r.content_json = body.content_json
    await db.commit()
    await db.refresh(r)
    return r


@router.post("/{master_id}/tailor", response_model=TailorResponse)
async def tailor_endpoint(
    master_id: int,
    body: TailorRequest,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    master = await db.get(Resume, master_id)
    if master is None or master.user_id != user_id:
        raise HTTPException(404)
    if master.kind != "master":
        raise HTTPException(400, detail={"error": "not_a_master_resume"})

    result: TailorResult = await tailor_resume(
        master_latex=master.latex_source,
        jd_text=body.jd_text,
        user_pinned=master.protected_terms or [],
        deep_tailor=body.deep_tailor,
    )

    if not result.enforced:
        raise HTTPException(
            422,
            detail={
                "error": "not_one_page",
                "page_count": result.page_count,
                "iterations": result.iterations,
            },
        )

    jd = JobDescription(
        user_id=user_id,
        title=body.title,
        company=body.company,
        url=body.url,
        raw_text=body.jd_text,
        parsed_json={"keywords": result.keywords_used},
    )
    db.add(jd)
    await db.flush()

    variant = Resume(
        user_id=user_id,
        parent_id=master.id,
        kind="variant",
        name=f"{master.name} \u2014 {body.company}",
        template_id=master.template_id,
        latex_source=result.variant_latex,
        job_description_id=jd.id,
        protected_terms=master.protected_terms or [],
    )
    db.add(variant)
    await db.commit()
    await db.refresh(variant)

    return TailorResponse(
        variant=ResumeOut.model_validate(variant),
        jd_id=jd.id,
        page_count=result.page_count,
        iterations=result.iterations,
        enforced=result.enforced,
        tier_history=result.tier_history,
        keywords_used=result.keywords_used,
    )
