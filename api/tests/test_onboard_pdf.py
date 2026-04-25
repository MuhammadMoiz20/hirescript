import pytest
from unittest.mock import patch, AsyncMock
from app.services.onboard_pdf import map_pdf_to_jakes_content
from app.services.agent import AgentError


async def test_returns_dict_with_expected_keys():
    with patch("app.services.onboard_pdf.query_json", new=AsyncMock(return_value={
        "header": {"name": "Foo", "tagline": "", "contacts": []},
        "education": [], "experience": [], "projects": [], "skills": {},
    })):
        out = await map_pdf_to_jakes_content(raw_text="some text")
    assert set(out.keys()) >= {"header","education","experience","projects","skills"}


async def test_uses_sonnet():
    spy = AsyncMock(return_value={"header": {}, "education": [], "experience": [], "projects": [], "skills": {}})
    with patch("app.services.onboard_pdf.query_json", new=spy):
        await map_pdf_to_jakes_content(raw_text="x")
    assert spy.call_args.kwargs["tier"] == "sonnet"


async def test_raises_on_empty_text():
    with pytest.raises(AgentError):
        await map_pdf_to_jakes_content(raw_text="   ")


async def test_backfills_missing_keys():
    with patch("app.services.onboard_pdf.query_json", new=AsyncMock(return_value={"header": {"name":"Y"}})):
        out = await map_pdf_to_jakes_content(raw_text="x")
    assert "experience" in out and out["experience"] == []
    assert "skills" in out and out["skills"] == {}
