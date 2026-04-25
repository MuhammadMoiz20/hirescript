import pytest
from unittest.mock import patch, AsyncMock
from app.services.tailor import tailor_resume, TailorResult
from app.services.enforcer import EnforceResult
from app.services.agent import AgentError


def _ef(latex="\\documentclass{article}\\begin{document}x\\end{document}", page_count=1, enforced=True, iters=0, tiers=None):
    return EnforceResult(
        latex=latex, pdf=b"%PDF...", page_count=page_count,
        iterations=iters, enforced=enforced, tier_history=tiers or [], log=[],
    )


@pytest.fixture
def patches():
    with patch("app.services.tailor.extract_keywords", new=AsyncMock(return_value=["python","fastapi"])) as ek, \
         patch("app.services.tailor.query_json", new=AsyncMock(return_value={"latex":"\\documentclass{article}\\begin{document}tailored\\end{document}","rationale":"ok"})) as qj, \
         patch("app.services.tailor.enforce_one_page", new=AsyncMock(return_value=_ef())) as ef:
        yield ek, qj, ef


async def test_returns_tailor_result(patches):
    out = await tailor_resume(master_latex="\\documentclass{article}\\begin{document}m\\end{document}", jd_text="JD")
    assert isinstance(out, TailorResult)
    assert out.enforced is True
    assert out.keywords_used == ["python","fastapi"]


async def test_default_tier_is_sonnet(patches):
    _, qj, _ = patches
    await tailor_resume(master_latex="\\documentclass{article}\\begin{document}\\end{document}", jd_text="JD")
    assert qj.call_args.kwargs["tier"] == "sonnet"


async def test_deep_tailor_uses_opus(patches):
    _, qj, _ = patches
    await tailor_resume(master_latex="\\documentclass{article}\\begin{document}\\end{document}", jd_text="JD", deep_tailor=True)
    assert qj.call_args.kwargs["tier"] == "opus"


async def test_includes_protected_terms_in_system_prompt(patches):
    _, qj, _ = patches
    await tailor_resume(master_latex="\\documentclass{article}\\begin{document}\\end{document}", jd_text="JD", user_pinned=["graphql"])
    sys_prompt = qj.call_args.kwargs["system_prompt"]
    # JD-derived (python, fastapi) + user-pinned (graphql) + base verbs all appear in protected list
    assert "python" in sys_prompt
    assert "graphql" in sys_prompt


async def test_raises_when_model_returns_no_latex():
    with patch("app.services.tailor.extract_keywords", new=AsyncMock(return_value=[])), \
         patch("app.services.tailor.query_json", new=AsyncMock(return_value={"rationale":"oops"})), \
         patch("app.services.tailor.enforce_one_page", new=AsyncMock(return_value=_ef())):
        with pytest.raises(AgentError):
            await tailor_resume(master_latex="\\documentclass{article}\\begin{document}\\end{document}", jd_text="JD")


async def test_passes_master_to_user_prompt(patches):
    _, qj, _ = patches
    await tailor_resume(master_latex="\\documentclass{article}\\begin{document}MASTER_BODY\\end{document}", jd_text="JD")
    assert "MASTER_BODY" in qj.call_args.kwargs["user_prompt"]
    assert "JD" in qj.call_args.kwargs["user_prompt"]
