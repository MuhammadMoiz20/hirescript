"""Tests for the JD keyword extractor."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.services.agent import AgentError
from app.services.jd_parser import extract_keywords


async def test_returns_lowercased_dedup():
    with patch(
        "app.services.jd_parser.query_json",
        new=AsyncMock(
            return_value={
                "keywords": ["Python", "python", "FastAPI", "fastapi", "React"]
            }
        ),
    ):
        out = await extract_keywords(raw_text="JD body")
    assert out == ["python", "fastapi", "react"]


async def test_empty_input_returns_empty():
    out = await extract_keywords(raw_text="   ")
    assert out == []


async def test_filters_non_strings():
    with patch(
        "app.services.jd_parser.query_json",
        new=AsyncMock(return_value={"keywords": ["led", 42, None, "shipped"]}),
    ):
        out = await extract_keywords(raw_text="x")
    assert out == ["led", "shipped"]


async def test_raises_on_bad_shape():
    with patch(
        "app.services.jd_parser.query_json",
        new=AsyncMock(return_value={"foo": "bar"}),
    ):
        with pytest.raises(AgentError):
            await extract_keywords(raw_text="x")


async def test_uses_haiku_tier():
    spy = AsyncMock(return_value={"keywords": []})
    with patch("app.services.jd_parser.query_json", new=spy):
        await extract_keywords(raw_text="x")
    spy.assert_awaited_once()
    assert spy.call_args.kwargs["tier"] == "haiku"
