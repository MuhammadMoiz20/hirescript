"""Tests for the OnePageEnforcer repair loop.

These tests mock both ``compile_latex`` and ``repair_overflow`` so no real
LaTeX compilation or model calls occur.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import enforcer as enforcer_mod
from app.services.agent import AgentError
from app.services.compile import CompileResult
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


async def test_agent_error_breaks_loop():
    fake_compile = MagicMock(side_effect=_compile_side_effect([2]))
    fake_repair = AsyncMock(side_effect=AgentError("boom"))
    with patch.object(enforcer_mod, "compile_latex", fake_compile), patch.object(
        enforcer_mod, "repair_overflow", fake_repair
    ):
        result = await enforce_one_page(
            candidate_latex="long",
            protected_terms=[],
        )
    assert result.iterations == 1
    assert result.enforced is False
    assert any("AgentError" in line or "boom" in line for line in result.log)


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
