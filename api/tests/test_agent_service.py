"""Tests for the agent service wrapper.

These tests mock ``claude_agent_sdk.query`` so no real model calls occur.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.services import agent as agent_mod
from app.services.agent import (
    AgentError,
    MODELS,
    edit_resume,
    repair_overflow,
)


class _FakeAsyncIter:
    def __init__(self, items):
        self.items = list(items)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self.items:
            raise StopAsyncIteration
        return self.items.pop(0)


def _assistant_message(*texts: str):
    """Build a real ``AssistantMessage`` with ``TextBlock`` content."""
    from claude_agent_sdk import AssistantMessage, TextBlock

    blocks = [TextBlock(text=t) for t in texts]
    # AssistantMessage is a dataclass with several required fields. Use the
    # minimum that the service actually reads (``content``); fill the rest
    # with safe defaults.
    return AssistantMessage(
        content=blocks,
        model="test-model",
        parent_tool_use_id=None,
        error=None,
        usage=None,
        message_id="m-1",
        stop_reason=None,
        session_id="s-1",
        uuid="u-1",
    )


async def _drain(aiter):
    out = []
    async for chunk in aiter:
        out.append(chunk)
    return out


async def test_edit_resume_streams_text_blocks():
    msgs = [
        _assistant_message("diff line 1\n"),
        _assistant_message("diff line 2\n"),
    ]
    fake_query = MagicMock(return_value=_FakeAsyncIter(msgs))
    with patch.object(agent_mod, "query", fake_query):
        chunks = await _drain(
            edit_resume(
                current_latex="\\documentclass{article}",
                instruction="tighten",
                protected_terms=[],
                page_count_hint=1,
            )
        )
    assert chunks == ["diff line 1\n", "diff line 2\n"]


async def test_edit_resume_uses_haiku_by_default():
    fake_query = MagicMock(return_value=_FakeAsyncIter([]))
    with patch.object(agent_mod, "query", fake_query):
        await _drain(
            edit_resume(
                current_latex="x",
                instruction="y",
                protected_terms=[],
                page_count_hint=1,
            )
        )
    options = fake_query.call_args.kwargs["options"]
    assert options.model == MODELS["haiku"]


async def test_edit_resume_routes_sonnet_when_requested():
    fake_query = MagicMock(return_value=_FakeAsyncIter([]))
    with patch.object(agent_mod, "query", fake_query):
        await _drain(
            edit_resume(
                current_latex="x",
                instruction="y",
                protected_terms=[],
                page_count_hint=1,
                tier="sonnet",
            )
        )
    options = fake_query.call_args.kwargs["options"]
    assert options.model == MODELS["sonnet"]


async def test_system_prompt_includes_one_page_rule():
    fake_query = MagicMock(return_value=_FakeAsyncIter([]))
    protected = ["Python", "Kubernetes", "led"]
    with patch.object(agent_mod, "query", fake_query):
        await _drain(
            edit_resume(
                current_latex="x",
                instruction="y",
                protected_terms=protected,
                page_count_hint=2,
            )
        )
    options = fake_query.call_args.kwargs["options"]
    sp = options.system_prompt or ""
    assert "one page" in sp.lower()
    for term in protected:
        assert term in sp


async def test_repair_overflow_parses_json_envelope():
    payload = '{"diff":"--- a\\n+++ b\\n","removed_terms":[],"rationale":"ok"}'
    msgs = [_assistant_message(payload)]
    fake_query = MagicMock(return_value=_FakeAsyncIter(msgs))
    with patch.object(agent_mod, "query", fake_query):
        result = await repair_overflow(
            current_latex="x",
            last_diff="d",
            page_count=2,
            protected_terms=["Python"],
            tier="sonnet",
        )
    assert result["diff"] == "--- a\n+++ b\n"
    assert result["removed_terms"] == []
    assert result["rationale"] == "ok"


async def test_repair_overflow_tolerates_json_fences():
    """Models often wrap output in ```json ... ``` despite instructions."""
    payload = (
        "```json\n"
        '{"diff":"\\\\documentclass{article}","removed_terms":[],"rationale":"ok"}\n'
        "```"
    )
    msgs = [_assistant_message(payload)]
    fake_query = MagicMock(return_value=_FakeAsyncIter(msgs))
    with patch.object(agent_mod, "query", fake_query):
        result = await repair_overflow(
            current_latex="x",
            last_diff="d",
            page_count=2,
            protected_terms=[],
            tier="sonnet",
        )
    assert result["diff"] == "\\documentclass{article}"


async def test_repair_overflow_extracts_object_from_prose():
    """If the model adds prose around the JSON, extract the first object."""
    payload = (
        "Here is the revised resume:\n"
        '{"diff":"X","removed_terms":[],"rationale":"r"}\n'
        "Hope that helps."
    )
    msgs = [_assistant_message(payload)]
    fake_query = MagicMock(return_value=_FakeAsyncIter(msgs))
    with patch.object(agent_mod, "query", fake_query):
        result = await repair_overflow(
            current_latex="x",
            last_diff="d",
            page_count=2,
            protected_terms=[],
            tier="sonnet",
        )
    assert result["diff"] == "X"


async def test_repair_overflow_raises_on_invalid_json():
    msgs = [_assistant_message("not json")]
    fake_query = MagicMock(return_value=_FakeAsyncIter(msgs))
    with patch.object(agent_mod, "query", fake_query):
        with pytest.raises(AgentError):
            await repair_overflow(
                current_latex="x",
                last_diff="d",
                page_count=2,
                protected_terms=[],
                tier="sonnet",
            )


async def test_repair_overflow_raises_when_protected_term_removed():
    payload = '{"diff":"x","removed_terms":["led"],"rationale":"x"}'
    msgs = [_assistant_message(payload)]
    fake_query = MagicMock(return_value=_FakeAsyncIter(msgs))
    with patch.object(agent_mod, "query", fake_query):
        with pytest.raises(AgentError):
            await repair_overflow(
                current_latex="x",
                last_diff="d",
                page_count=2,
                protected_terms=["led"],
                tier="sonnet",
            )


async def test_repair_overflow_includes_overflow_hints_in_prompt():
    """When overflow_hints are provided, the user prompt must list each
    offending bullet so the model knows which lines to tighten."""
    payload = '{"diff":"X","removed_terms":[],"rationale":"r"}'
    msgs = [_assistant_message(payload)]
    fake_query = MagicMock(return_value=_FakeAsyncIter(msgs))
    hints = [
        {"overflow_pt": 12.34, "line_start": 42, "line_end": 44,
         "snippet": "Built async FastAPI services in Python handling OAuth"},
        {"overflow_pt": 3.5, "line_start": 51, "line_end": 52,
         "snippet": "Architected MCP servers"},
    ]
    with patch.object(agent_mod, "query", fake_query):
        await repair_overflow(
            current_latex="x",
            last_diff="d",
            page_count=1,
            protected_terms=[],
            tier="haiku",
            overflow_hints=hints,
        )
    user_prompt = fake_query.call_args.kwargs["prompt"]
    assert "Horizontal overflow" in user_prompt
    assert "FastAPI" in user_prompt
    assert "12.3pt" in user_prompt
    assert "lines 42-44" in user_prompt
    # 1-page case must use the 1-page-with-overflow situation copy
    assert "already fits on 1 page" in user_prompt


async def test_repair_overflow_omits_hints_block_when_none():
    payload = '{"diff":"X","removed_terms":[],"rationale":"r"}'
    msgs = [_assistant_message(payload)]
    fake_query = MagicMock(return_value=_FakeAsyncIter(msgs))
    with patch.object(agent_mod, "query", fake_query):
        await repair_overflow(
            current_latex="x", last_diff="d", page_count=2,
            protected_terms=[], tier="haiku",
        )
    user_prompt = fake_query.call_args.kwargs["prompt"]
    assert "Horizontal overflow" not in user_prompt
    assert "compiles to 2 pages" in user_prompt
