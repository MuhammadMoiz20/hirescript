import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from app.services.onboard import onboard_from_pdf, onboard_from_latex
from app.services.enforcer import EnforceResult


def _ef(latex="\\documentclass{article}\\begin{document}x\\end{document}", page_count=1, enforced=True, iters=0):
    return EnforceResult(
        latex=latex, pdf=b"%PDF...", page_count=page_count,
        iterations=iters, enforced=enforced, tier_history=[], log=[],
    )


@pytest.fixture
def patches():
    with patch("app.services.onboard.extract_pdf_text", return_value="raw text") as ext, \
         patch("app.services.onboard.map_pdf_to_jakes_content", new=AsyncMock(return_value={"header":{"name":"X","tagline":"","contacts":[]},"education":[],"experience":[],"projects":[],"skills":{}})) as mp, \
         patch("app.services.onboard.render_jakes", return_value="\\documentclass{article}\\begin{document}rendered\\end{document}") as rj, \
         patch("app.services.onboard.parse_jakes", return_value={"header":{"name":"X"},"education":[],"experience":[],"projects":[],"skills":{}}) as pj, \
         patch("app.services.onboard.enforce_one_page", new=AsyncMock(return_value=_ef())) as ef:
        yield ext, mp, rj, pj, ef


async def test_pdf_path_invokes_full_pipeline(patches):
    out = await onboard_from_pdf(pdf_bytes=b"%PDF...")
    assert out.enforced is True
    ext, mp, rj, pj, ef = patches
    ext.assert_called_once()
    mp.assert_awaited_once()
    rj.assert_called_once()
    ef.assert_awaited_once()


async def test_pdf_path_returns_overflow_when_not_enforced():
    with patch("app.services.onboard.extract_pdf_text", return_value="x"), \
         patch("app.services.onboard.map_pdf_to_jakes_content", new=AsyncMock(return_value={"header":{},"education":[],"experience":[],"projects":[],"skills":{}})), \
         patch("app.services.onboard.render_jakes", return_value="..."), \
         patch("app.services.onboard.parse_jakes", return_value={}), \
         patch("app.services.onboard.enforce_one_page", new=AsyncMock(return_value=_ef(page_count=2, enforced=False, iters=4))):
        out = await onboard_from_pdf(pdf_bytes=b"%PDF...")
    assert out.enforced is False
    assert out.page_count == 2
    assert out.iterations == 4


async def test_latex_path_skips_pdf_and_mapper():
    with patch("app.services.onboard.parse_jakes", return_value={"header":{"name":"L"}}), \
         patch("app.services.onboard.enforce_one_page", new=AsyncMock(return_value=_ef(latex="\\documentclass{article}\\begin{document}foo\\end{document}"))):
        out = await onboard_from_latex(latex="\\documentclass{article}\\begin{document}foo\\end{document}")
    assert out.enforced is True
    assert out.latex_source.startswith("\\documentclass")


async def test_latex_path_tolerates_non_jakes_input():
    with patch("app.services.onboard.parse_jakes", side_effect=Exception("not jakes")), \
         patch("app.services.onboard.enforce_one_page", new=AsyncMock(return_value=_ef())):
        out = await onboard_from_latex(latex="\\documentclass{article}\\begin{document}\\end{document}")
    assert out.content_json == {}
