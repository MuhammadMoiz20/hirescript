"""OnePageEnforcer repair loop.

Compiles a candidate LaTeX document and, when it overflows one page, asks the
agent service to produce a revised document. Iterates up to ``max_iterations``
times, escalating from Haiku to Sonnet at iteration 3+.

The agent service's ``repair_overflow`` returns a ``diff`` field that, by
contract, carries the FULL revised LaTeX document (not a unidiff hunk). This
keeps the enforcer simple: each iteration just replaces the candidate with
whatever the model returned and recompiles.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from app.services.agent import AgentError, ModelTier, repair_overflow
from app.services.compile import compile_latex

ProgressFn = Callable[[str, dict[str, Any]], Awaitable[None]]


async def _noop(event: str, data: dict[str, Any]) -> None:
    return None


@dataclass(frozen=True)
class EnforceResult:
    latex: str
    pdf: bytes
    page_count: int
    iterations: int
    enforced: bool
    tier_history: list[str] = field(default_factory=list)
    log: list[str] = field(default_factory=list)


def _tier_for_iteration(iter_index: int) -> ModelTier:
    """iter_index is 1-based. 1-2 -> haiku, 3+ -> sonnet."""
    return "haiku" if iter_index <= 2 else "sonnet"


async def enforce_one_page(
    *,
    candidate_latex: str,
    protected_terms: list[str],
    max_iterations: int = 4,
    on_progress: ProgressFn | None = None,
) -> EnforceResult:
    """Compile ``candidate_latex`` and, if it is multi-page, repair-loop.

    Returns the best attempt. ``enforced=True`` iff the final compile was
    exactly one page.

    ``on_progress`` is called at each phase boundary with one of:
      ("compile_start",   {})
      ("compile_done",    {"page_count": int})
      ("repair_start",    {"iteration": int, "tier": str, "page_count": int})
      ("repair_compile_done", {"iteration": int, "page_count": int})
    """
    progress = on_progress or _noop
    log: list[str] = []
    tier_history: list[str] = []

    current_latex = candidate_latex
    await progress("compile_start", {})
    compile_result = await asyncio.to_thread(compile_latex, current_latex)
    current_pdf = compile_result.pdf
    current_page_count = compile_result.page_count
    await progress("compile_done", {"page_count": current_page_count})

    if current_page_count == 1:
        return EnforceResult(
            latex=current_latex,
            pdf=current_pdf,
            page_count=1,
            iterations=0,
            enforced=True,
            tier_history=[],
            log=[],
        )

    last_diff = ""
    iterations = 0

    for iter_index in range(1, max_iterations + 1):
        tier = _tier_for_iteration(iter_index)
        tier_history.append(tier)
        iterations = iter_index
        log.append(
            f"iteration {iter_index}: page_count={current_page_count}, "
            f"calling repair_overflow tier={tier}"
        )
        await progress(
            "repair_start",
            {"iteration": iter_index, "tier": tier, "page_count": current_page_count},
        )

        try:
            repair = await repair_overflow(
                current_latex=current_latex,
                last_diff=last_diff,
                page_count=current_page_count,
                protected_terms=protected_terms,
                tier=tier,
            )
        except AgentError as exc:
            log.append(f"iteration {iter_index}: AgentError {exc}; aborting loop")
            break

        revised_latex = repair["diff"]
        last_diff = revised_latex
        current_latex = revised_latex

        compile_result = await asyncio.to_thread(compile_latex, current_latex)
        current_pdf = compile_result.pdf
        current_page_count = compile_result.page_count

        log.append(
            f"iteration {iter_index}: post-repair page_count={current_page_count}"
        )
        await progress(
            "repair_compile_done",
            {"iteration": iter_index, "page_count": current_page_count},
        )

        if current_page_count == 1:
            return EnforceResult(
                latex=current_latex,
                pdf=current_pdf,
                page_count=1,
                iterations=iterations,
                enforced=True,
                tier_history=tier_history,
                log=log,
            )

    return EnforceResult(
        latex=current_latex,
        pdf=current_pdf,
        page_count=current_page_count,
        iterations=iterations,
        enforced=False,
        tier_history=tier_history,
        log=log,
    )
