from dataclasses import dataclass
from app.services.agent import query_json, AgentError, ModelTier
from app.services.jd_parser import extract_keywords
from app.services.enforcer import enforce_one_page
from app.services.protected_terms import resolve_protected_terms


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
"""


async def tailor_resume(
    *,
    master_latex: str,
    jd_text: str,
    user_pinned: list[str] | None = None,
    deep_tailor: bool = False,
) -> TailorResult:
    keywords = await extract_keywords(raw_text=jd_text)
    protected = resolve_protected_terms(user_pinned=user_pinned or [], jd_terms=keywords)
    tier: ModelTier = "opus" if deep_tailor else "sonnet"
    system = _SYSTEM_TEMPLATE.format(protected_terms_csv=", ".join(protected))
    user = (
        "SOURCE_RESUME_LATEX:\n```latex\n" + master_latex + "\n```\n\n"
        "JOB_DESCRIPTION:\n```\n" + jd_text + "\n```"
    )
    data = await query_json(system_prompt=system, user_prompt=user, tier=tier)
    candidate = data.get("latex")
    if not isinstance(candidate, str) or "\\documentclass" not in candidate:
        raise AgentError(f"unexpected tailor JSON: {data!r}")
    enforced = await enforce_one_page(
        candidate_latex=candidate, protected_terms=protected
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
