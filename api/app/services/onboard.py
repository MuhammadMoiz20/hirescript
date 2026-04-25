from dataclasses import dataclass

from app.services.pdf_text import extract_pdf_text
from app.services.onboard_pdf import map_pdf_to_jakes_content
from app.services.renderer_jakes import render_jakes
from app.services.parser_jakes import parse_jakes
from app.services.enforcer import enforce_one_page
from app.services.protected_terms import resolve_protected_terms


@dataclass(frozen=True)
class OnboardResult:
    latex_source: str
    content_json: dict
    pdf: bytes
    page_count: int
    enforced: bool
    iterations: int


async def onboard_from_pdf(*, pdf_bytes: bytes) -> OnboardResult:
    raw = extract_pdf_text(pdf_bytes)
    content = await map_pdf_to_jakes_content(raw_text=raw)
    candidate = render_jakes(content)
    enforced = await enforce_one_page(
        candidate_latex=candidate,
        protected_terms=resolve_protected_terms(),
    )
    final_content = parse_jakes(enforced.latex)
    return OnboardResult(
        latex_source=enforced.latex,
        content_json=final_content,
        pdf=enforced.pdf,
        page_count=enforced.page_count,
        enforced=enforced.enforced,
        iterations=enforced.iterations,
    )


async def onboard_from_latex(*, latex: str) -> OnboardResult:
    enforced = await enforce_one_page(
        candidate_latex=latex,
        protected_terms=resolve_protected_terms(),
    )
    # Try to parse for content_json; tolerate non-jakes inputs by storing {}.
    try:
        content = parse_jakes(enforced.latex)
    except Exception:
        content = {}
    return OnboardResult(
        latex_source=enforced.latex,
        content_json=content,
        pdf=enforced.pdf,
        page_count=enforced.page_count,
        enforced=enforced.enforced,
        iterations=enforced.iterations,
    )
