"""Tests for the OnePageEnforcer repair loop.

These tests mock both ``compile_latex`` and ``repair_overflow`` so no real
LaTeX compilation or model calls occur.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import enforcer as enforcer_mod
from app.services.agent import AgentError
from app.services.compile import CompileResult, OverflowHint
from app.services.enforcer import enforce_one_page


def _compile_side_effect(page_counts: list[int]):
    """Build a side_effect that returns CompileResult with given page counts."""
    seq = list(page_counts)

    def _side(*args, **kwargs):
        if not seq:
            # If exhausted, repeat the last value to keep tests robust.
            pc = page_counts[-1]
        else:
            pc = seq.pop(0)
        return CompileResult(pdf=b"%PDF-fake", page_count=pc)

    return _side


def _compile_with_overflows(sequence: list[tuple[int, tuple[OverflowHint, ...]]]):
    """side_effect that returns CompileResults from (page_count, overflows) tuples."""
    seq = list(sequence)

    def _side(*args, **kwargs):
        item = seq.pop(0) if seq else sequence[-1]
        pc, overflows = item
        return CompileResult(pdf=b"%PDF-fake", page_count=pc, overflows=overflows)

    return _side


def _hint(snippet: str = "overflowing line", pt: float = 4.5, ls: int = 42, le: int = 43):
    return OverflowHint(
        overflow_pt=pt, line_start=ls, line_end=le, snippet=snippet
    )


async def test_first_compile_is_one_page_returns_immediately():
    fake_compile = MagicMock(side_effect=_compile_side_effect([1]))
    fake_repair = AsyncMock()
    with patch.object(enforcer_mod, "compile_latex", fake_compile), patch.object(
        enforcer_mod, "repair_overflow", fake_repair
    ):
        result = await enforce_one_page(
            candidate_latex="\\documentclass{article}\\begin{document}x\\end{document}",
            protected_terms=[],
        )
    assert result.iterations == 0
    assert result.enforced is True
    assert result.page_count == 1
    assert result.tier_history == []
    fake_repair.assert_not_called()


async def test_converges_after_one_repair():
    fake_compile = MagicMock(side_effect=_compile_side_effect([2, 1]))
    fake_repair = AsyncMock(
        return_value={"diff": "shorter latex", "removed_terms": [], "rationale": "ok"}
    )
    with patch.object(enforcer_mod, "compile_latex", fake_compile), patch.object(
        enforcer_mod, "repair_overflow", fake_repair
    ):
        result = await enforce_one_page(
            candidate_latex="long latex",
            protected_terms=[],
        )
    assert result.iterations == 1
    assert result.enforced is True
    assert result.tier_history == ["haiku"]
    assert result.latex == "shorter latex"
    assert result.page_count == 1


async def test_escalates_to_sonnet_at_iter_3():
    fake_compile = MagicMock(side_effect=_compile_side_effect([2, 2, 2, 1]))
    fake_repair = AsyncMock(
        side_effect=[
            {"diff": "rev1", "removed_terms": [], "rationale": "r1"},
            {"diff": "rev2", "removed_terms": [], "rationale": "r2"},
            {"diff": "rev3", "removed_terms": [], "rationale": "r3"},
        ]
    )
    with patch.object(enforcer_mod, "compile_latex", fake_compile), patch.object(
        enforcer_mod, "repair_overflow", fake_repair
    ):
        result = await enforce_one_page(
            candidate_latex="long",
            protected_terms=[],
        )
    assert result.tier_history == ["haiku", "haiku", "sonnet"]
    assert result.enforced is True
    assert result.iterations == 3
    assert result.latex == "rev3"


async def test_exhausts_budget():
    fake_compile = MagicMock(side_effect=_compile_side_effect([2, 2, 2, 2, 2]))
    fake_repair = AsyncMock(
        return_value={"diff": "still long", "removed_terms": [], "rationale": "r"}
    )
    with patch.object(enforcer_mod, "compile_latex", fake_compile), patch.object(
        enforcer_mod, "repair_overflow", fake_repair
    ):
        result = await enforce_one_page(
            candidate_latex="long",
            protected_terms=[],
            max_iterations=4,
        )
    assert result.iterations == 4
    assert result.enforced is False
    assert len(result.tier_history) == 4
    assert result.tier_history == ["haiku", "haiku", "sonnet", "sonnet"]
    assert result.page_count == 2


async def test_agent_error_continues_to_next_iteration():
    """A single bad model output should not burn the whole repair budget."""
    fake_compile = MagicMock(side_effect=_compile_side_effect([2, 1]))
    fake_repair = AsyncMock(
        side_effect=[
            AgentError("boom"),
            {"diff": "shorter", "removed_terms": [], "rationale": "ok"},
        ]
    )
    with patch.object(enforcer_mod, "compile_latex", fake_compile), patch.object(
        enforcer_mod, "repair_overflow", fake_repair
    ):
        result = await enforce_one_page(
            candidate_latex="long",
            protected_terms=[],
        )
    assert result.iterations == 2
    assert result.enforced is True
    assert result.latex == "shorter"
    assert any("AgentError" in line or "boom" in line for line in result.log)


async def test_all_iterations_agent_error_exhausts_budget():
    fake_compile = MagicMock(side_effect=_compile_side_effect([2]))
    fake_repair = AsyncMock(side_effect=AgentError("boom"))
    with patch.object(enforcer_mod, "compile_latex", fake_compile), patch.object(
        enforcer_mod, "repair_overflow", fake_repair
    ):
        result = await enforce_one_page(
            candidate_latex="long",
            protected_terms=[],
            max_iterations=4,
        )
    assert result.iterations == 4
    assert result.enforced is False
    assert fake_repair.await_count == 4


async def test_passes_protected_terms_to_repair():
    fake_compile = MagicMock(side_effect=_compile_side_effect([2, 1]))
    fake_repair = AsyncMock(
        return_value={"diff": "shorter", "removed_terms": [], "rationale": "ok"}
    )
    protected = ["Python", "Kubernetes", "led"]
    with patch.object(enforcer_mod, "compile_latex", fake_compile), patch.object(
        enforcer_mod, "repair_overflow", fake_repair
    ):
        await enforce_one_page(
            candidate_latex="long",
            protected_terms=protected,
        )
    kwargs = fake_repair.call_args.kwargs
    assert kwargs["protected_terms"] == protected


async def test_log_contains_iteration_notes():
    fake_compile = MagicMock(side_effect=_compile_side_effect([2, 2, 1]))
    fake_repair = AsyncMock(
        side_effect=[
            {"diff": "rev1", "removed_terms": [], "rationale": "r"},
            {"diff": "rev2", "removed_terms": [], "rationale": "r"},
        ]
    )
    with patch.object(enforcer_mod, "compile_latex", fake_compile), patch.object(
        enforcer_mod, "repair_overflow", fake_repair
    ):
        result = await enforce_one_page(
            candidate_latex="long",
            protected_terms=[],
        )
    assert result.iterations == 2
    assert len(result.log) >= 2
    assert any("iteration 1" in line for line in result.log)
    assert any("iteration 2" in line for line in result.log)


async def test_one_page_with_overflows_still_repairs():
    """A 1-page doc with horizontal overflows must still trigger repair —
    overflowing bullets wrap to a second line with orphan words and waste
    space."""
    fake_compile = MagicMock(side_effect=_compile_with_overflows([
        (1, (_hint("Built async FastAPI backend services in Python handling OAuth"),)),
        (1, ()),
    ]))
    fake_repair = AsyncMock(
        return_value={"diff": "tightened", "removed_terms": [], "rationale": "ok"}
    )
    with patch.object(enforcer_mod, "compile_latex", fake_compile), patch.object(
        enforcer_mod, "repair_overflow", fake_repair
    ):
        result = await enforce_one_page(
            candidate_latex="long",
            protected_terms=["Python", "FastAPI", "OAuth"],
        )
    assert result.iterations == 1
    assert result.enforced is True
    assert result.page_count == 1
    assert result.overflows == ()
    assert result.latex == "tightened"


async def test_overflow_hints_passed_to_repair():
    """The repair_overflow agent must receive the overflow hints so it knows
    which lines to tighten."""
    hints = (
        _hint("Built async FastAPI backend services", pt=3.2, ls=42, le=44),
        _hint("Architected Google Calendar/Canvas MCP servers", pt=8.7, ls=51, le=53),
    )
    fake_compile = MagicMock(side_effect=_compile_with_overflows([
        (1, hints),
        (1, ()),
    ]))
    fake_repair = AsyncMock(
        return_value={"diff": "tightened", "removed_terms": [], "rationale": "ok"}
    )
    with patch.object(enforcer_mod, "compile_latex", fake_compile), patch.object(
        enforcer_mod, "repair_overflow", fake_repair
    ):
        await enforce_one_page(candidate_latex="x", protected_terms=[])
    kwargs = fake_repair.call_args.kwargs
    assert kwargs["overflow_hints"] is not None
    assert len(kwargs["overflow_hints"]) == 2
    assert kwargs["overflow_hints"][0]["overflow_pt"] == 3.2
    assert "FastAPI" in kwargs["overflow_hints"][0]["snippet"]


async def test_one_page_with_overflows_reports_unenforced_after_budget():
    """If repair budget exhausts and overflows persist (page_count stays 1),
    the run is NOT enforced — wraps/overfull warnings count as overflow,
    even though the doc happens to be one page. Surviving overflows are
    surfaced so callers can warn the user."""
    overflow = (_hint(),)
    fake_compile = MagicMock(side_effect=_compile_with_overflows([
        (1, overflow), (1, overflow), (1, overflow), (1, overflow), (1, overflow),
    ]))
    fake_repair = AsyncMock(
        return_value={"diff": "no help", "removed_terms": [], "rationale": "r"}
    )
    with patch.object(enforcer_mod, "compile_latex", fake_compile), patch.object(
        enforcer_mod, "repair_overflow", fake_repair
    ):
        result = await enforce_one_page(
            candidate_latex="x", protected_terms=[], max_iterations=4,
        )
    assert result.iterations == 4
    assert result.page_count == 1
    assert result.enforced is False  # persistent overflows => not enforced
    assert len(result.overflows) == 1


async def test_enforce_runs_loop_when_only_wraps_present():
    """A page_count==1 doc with wrap hints must trigger the repair loop;
    the loop runs because _is_clean checks for overflows too, not just
    page count."""
    wrap_hint = OverflowHint(
        overflow_pt=12.0, line_start=87, line_end=87,
        snippet="Optimized PostgreSQL via connection pooling, reducing p95...",
    )
    fake_compile = MagicMock(side_effect=_compile_with_overflows([
        (1, (wrap_hint,)),
        (1, ()),
    ]))
    captured: dict = {}

    async def fake_repair(**kwargs):
        captured.update(kwargs)
        assert kwargs["overflow_hints"], "wrap hint must be forwarded"
        assert "Optimized PostgreSQL" in kwargs["overflow_hints"][0]["snippet"]
        return {"diff": "REVISED LATEX", "removed_terms": [], "rationale": "ok"}

    with patch.object(enforcer_mod, "compile_latex", fake_compile), patch.object(
        enforcer_mod, "repair_overflow", fake_repair
    ):
        result = await enforce_one_page(
            candidate_latex="ORIGINAL LATEX",
            protected_terms=["PostgreSQL"],
        )
    assert result.enforced is True
    assert result.iterations == 1
    assert result.latex == "REVISED LATEX"


async def test_enforce_exhausts_when_wraps_persist():
    wrap_hint = OverflowHint(
        overflow_pt=12.0, line_start=87, line_end=87,
        snippet="bullet that never gets shorter",
    )
    fake_compile = MagicMock(side_effect=_compile_with_overflows([
        (1, (wrap_hint,)),
    ]))

    async def fake_repair(**kwargs):
        return {"diff": "STILL TOO LONG", "removed_terms": [], "rationale": "r"}

    with patch.object(enforcer_mod, "compile_latex", fake_compile), patch.object(
        enforcer_mod, "repair_overflow", fake_repair
    ):
        result = await enforce_one_page(
            candidate_latex="ORIGINAL",
            protected_terms=[],
            max_iterations=4,
        )
    assert result.enforced is False  # page_count==1 but overflows remain
    assert result.iterations == 4
    assert result.tier_history == ["haiku", "haiku", "sonnet", "sonnet"]


async def test_clean_first_compile_skips_repair():
    """1 page AND no overflows on first compile => no repair calls."""
    fake_compile = MagicMock(side_effect=_compile_with_overflows([(1, ())]))
    fake_repair = AsyncMock()
    with patch.object(enforcer_mod, "compile_latex", fake_compile), patch.object(
        enforcer_mod, "repair_overflow", fake_repair
    ):
        result = await enforce_one_page(candidate_latex="x", protected_terms=[])
    assert result.iterations == 0
    assert result.enforced is True
    fake_repair.assert_not_called()
