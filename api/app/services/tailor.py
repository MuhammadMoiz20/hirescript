from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import claude_router
from app.services.agent import query_json, AgentError, ModelTier
from app.services.jd_parser import extract_keywords
from app.services.enforcer import enforce_one_page
from app.services.protected_terms import resolve_protected_terms

ProgressFn = Callable[[str, dict[str, Any]], Awaitable[None]]


async def _noop(event: str, data: dict[str, Any]) -> None:
    return None


# Reverse map of router-emitted model IDs back to Agent SDK tier labels.
_MODEL_ID_TO_TIER: dict[str, ModelTier] = {
    "claude-haiku-4-5": "haiku",
    "claude-sonnet-4-6": "sonnet",
    "claude-opus-4-7": "opus",
}


@dataclass(frozen=True)
class TailorResult:
    variant_latex: str
    pdf: bytes
    page_count: int
    enforced: bool
    iterations: int
    tier_history: list[str]
    keywords_used: list[str]


_SYSTEM_TEMPLATE = """\
You tailor an existing LaTeX resume to a target job description.
Return ONLY a JSON object: {{"latex": "<full revised LaTeX document>", "rationale": "<short>"}}.

Hard rules:
- Output a complete LaTeX document, ready to compile (\\documentclass through \\end{{document}}).
- Must compile to exactly one US-letter page; tighten phrasing if needed, never truncate.
- Preserve all of these protected terms when they make sense in context: {protected_terms_csv}
- Reuse the structural commands from the source document (do not change templates).
- Reorder bullets to highlight what aligns to the JD; cut weak/irrelevant items.
- No commentary outside the JSON.

Bullet density rules (important — short bullets that leave half the line blank
look unprofessional):
- Every bullet must render as exactly one line that fills approximately
  90-100% of the available column width (target ~95-115 visible characters
  for typical 10-11pt resume fonts, including the leading verb).
- If a bullet would render shorter than ~85 characters, EXPAND it with a
  concrete metric, scope qualifier, technology, or downstream impact drawn
  from the source resume — never invent facts that aren't in the master.
- If a bullet would wrap to two lines, tighten phrasing (cut filler words,
  combine clauses, drop weak qualifiers) until it fits on one line.
- Prefer dropping a weak bullet entirely over keeping a stubby half-line one.
- Lead each bullet with a strong action verb; avoid hedging language
  ("helped", "assisted", "worked on") unless it is a protected term.
"""


async def tailor_resume(
    *,
    master_latex: str,
    jd_text: str,
    user_pinned: list[str] | None = None,
    deep_tailor: bool = False,
    on_progress: ProgressFn | None = None,
    system_prompt_addendum: str | None = None,
    db: AsyncSession | None = None,
    tier_slug: str | None = None,
    one_line_per_bullet: bool = False,
) -> TailorResult:
    progress = on_progress or _noop
    await progress("keywords_start", {})
    keywords = await extract_keywords(raw_text=jd_text)
    await progress("keywords_done", {"count": len(keywords)})
    protected = resolve_protected_terms(user_pinned=user_pinned or [], jd_terms=keywords)
    tier: ModelTier = "opus" if deep_tailor else "sonnet"
    # Consult the router when we have a db session. If the router selects an
    # opus/sonnet/haiku model id we map it back to the agent SDK tier so the
    # downstream call still picks the right model. The deep_tailor flag wins
    # because it represents an explicit user choice ("Deep tailor" button).
    choice: claude_router.ClientChoice | None = None
    if db is not None:
        choice = await claude_router.choose(
            db, task_kind="tailor", tier_slug=tier_slug
        )
        if not deep_tailor:
            tier = _MODEL_ID_TO_TIER.get(choice["model"], tier)
    system = _SYSTEM_TEMPLATE.format(protected_terms_csv=", ".join(protected))
    if system_prompt_addendum:
        system = system + "\n\n" + system_prompt_addendum
    user = (
        "SOURCE_RESUME_LATEX:\n```latex\n" + master_latex + "\n```\n\n"
        "JOB_DESCRIPTION:\n```\n" + jd_text + "\n```"
    )
    await progress("draft_start", {"tier": tier})
    data = await query_json(system_prompt=system, user_prompt=user, tier=tier)
    if db is not None and choice is not None:
        await claude_router.record_usage(
            db,
            client=choice["client"],
            model=choice["model"],
            task_kind="tailor",
            input_tokens=0,
            output_tokens=0,
        )
    candidate = data.get("latex")
    if not isinstance(candidate, str) or "\\documentclass" not in candidate:
        raise AgentError(f"unexpected tailor JSON: {data!r}")
    await progress("draft_done", {"chars": len(candidate)})
    enforced = await enforce_one_page(
        candidate_latex=candidate,
        protected_terms=protected,
        on_progress=progress,
        detect_wraps=one_line_per_bullet,
    )
    return TailorResult(
        variant_latex=enforced.latex,
        pdf=enforced.pdf,
        page_count=enforced.page_count,
        enforced=enforced.enforced,
        iterations=enforced.iterations,
        tier_history=enforced.tier_history,
        keywords_used=keywords,
    )
