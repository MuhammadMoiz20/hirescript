"""Agent service wrapper.

This module is the ONLY place ``claude_agent_sdk.query`` is invoked. It owns:

- Model routing across Haiku 4.5 / Sonnet 4.6 / Opus 4.7.
- A unified system prompt that always carries the one-page rule, the protected
  terms list, and the current page-count hint.
- A strict JSON envelope contract for ``repair_overflow``.
- Streaming text chunks for ``edit_resume``.

Caching is delegated to the local ``claude`` CLI used by the SDK; we do not set
manual ``cache_control`` headers from this layer.
"""

from __future__ import annotations

import json
from typing import AsyncIterator, Literal, TypedDict

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    TextBlock,
    query,
)

ModelTier = Literal["haiku", "sonnet", "opus"]

MODELS: dict[ModelTier, str] = {
    "haiku": "claude-haiku-4-5",
    "sonnet": "claude-sonnet-4-6",
    "opus": "claude-opus-4-7",
}


class RepairResult(TypedDict):
    diff: str
    removed_terms: list[str]
    rationale: str


class AgentError(RuntimeError):
    """Raised when the model returns malformed output or violates invariants."""


def _format_protected_terms(protected_terms: list[str]) -> str:
    if not protected_terms:
        return "(none)"
    return ", ".join(protected_terms)


def _build_system_prompt(
    *,
    protected_terms: list[str],
    page_count_hint: int,
    mode: Literal["edit", "repair"],
) -> str:
    base = (
        "You are HireScript's resume editing agent. You operate on a LaTeX "
        "resume that MUST compile to exactly one page. Never truncate, clip, "
        "or hide content to force one page; rewrite intelligently instead.\n\n"
        f"Current page count hint: {page_count_hint}.\n"
        f"Protected terms (must NEVER be removed or altered): "
        f"{_format_protected_terms(protected_terms)}.\n"
    )
    if mode == "edit":
        return base + (
            "\nRespond with a unified diff that applies the requested edit to "
            "the LaTeX source. Use standard `---`/`+++` file headers and `@@` "
            "hunks. Do not include prose outside the diff."
        )
    # repair
    return base + (
        "\nThe resume currently overflows one page. Produce ONE repair "
        "iteration. Respond with ONLY a single JSON object and nothing else "
        "(no markdown fences, no commentary), matching this schema exactly:\n"
        '{"diff": "<unified diff string>", '
        '"removed_terms": ["..."], '
        '"rationale": "<short explanation>"}\n'
        "`removed_terms` must list any terms you dropped; it MUST NOT contain "
        "any protected term."
    )


def _extract_text(msg: object) -> str:
    """Concatenate ``TextBlock`` text from an ``AssistantMessage``."""
    if not isinstance(msg, AssistantMessage):
        return ""
    parts: list[str] = []
    for block in msg.content:
        if isinstance(block, TextBlock):
            parts.append(block.text)
    return "".join(parts)


async def edit_resume(
    *,
    current_latex: str,
    instruction: str,
    protected_terms: list[str],
    page_count_hint: int,
    tier: ModelTier = "haiku",
) -> AsyncIterator[str]:
    """Stream textual chunks of a unified diff that applies the requested edit.

    The caller is responsible for parsing/applying the diff and compiling.
    """
    system_prompt = _build_system_prompt(
        protected_terms=protected_terms,
        page_count_hint=page_count_hint,
        mode="edit",
    )
    options = ClaudeAgentOptions(
        model=MODELS[tier],
        system_prompt=system_prompt,
    )
    user_prompt = (
        f"Instruction:\n{instruction}\n\n"
        f"Current LaTeX source:\n```latex\n{current_latex}\n```\n"
    )
    async for msg in query(prompt=user_prompt, options=options):
        text = _extract_text(msg)
        if text:
            yield text


async def repair_overflow(
    *,
    current_latex: str,
    last_diff: str,
    page_count: int,
    protected_terms: list[str],
    tier: ModelTier,
) -> RepairResult:
    """One repair iteration. Non-streaming. Returns parsed JSON envelope.

    Raises ``AgentError`` if the model returns invalid JSON or violates
    protected terms.
    """
    system_prompt = _build_system_prompt(
        protected_terms=protected_terms,
        page_count_hint=page_count,
        mode="repair",
    )
    options = ClaudeAgentOptions(
        model=MODELS[tier],
        system_prompt=system_prompt,
    )
    user_prompt = (
        f"The resume currently compiles to {page_count} pages and must fit on "
        f"exactly 1 page.\n\n"
        f"Most recent diff applied:\n```diff\n{last_diff}\n```\n\n"
        f"Current LaTeX source:\n```latex\n{current_latex}\n```\n"
    )
    collected: list[str] = []
    async for msg in query(prompt=user_prompt, options=options):
        text = _extract_text(msg)
        if text:
            collected.append(text)
    raw = "".join(collected).strip()
    if not raw:
        raise AgentError("Model returned no text for repair_overflow")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise AgentError(f"Model returned invalid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise AgentError("Repair envelope must be a JSON object")
    for key in ("diff", "removed_terms", "rationale"):
        if key not in parsed:
            raise AgentError(f"Repair envelope missing required key: {key}")
    if not isinstance(parsed["diff"], str) or not isinstance(
        parsed["rationale"], str
    ):
        raise AgentError("Repair envelope `diff` and `rationale` must be strings")
    if not isinstance(parsed["removed_terms"], list) or not all(
        isinstance(t, str) for t in parsed["removed_terms"]
    ):
        raise AgentError("Repair envelope `removed_terms` must be list[str]")
    protected_set = {t.lower() for t in protected_terms}
    violated = [t for t in parsed["removed_terms"] if t.lower() in protected_set]
    if violated:
        raise AgentError(
            f"Model removed protected terms: {violated}"
        )
    return RepairResult(
        diff=parsed["diff"],
        removed_terms=list(parsed["removed_terms"]),
        rationale=parsed["rationale"],
    )
