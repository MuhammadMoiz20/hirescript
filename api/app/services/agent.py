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
import re
import sys
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
            "\nIf the user's message is a greeting, a question, or otherwise "
            "does NOT request a concrete edit to the resume, reply briefly in "
            "plain prose. DO NOT include any JSON, code fence, or LaTeX in "
            "that case.\n\n"
            "If the user requests an edit, respond with EXACTLY ONE fenced "
            "JSON code block at the end of your reply (no other JSON, no "
            "prose after it):\n"
            "```json\n"
            '{\"latex\": \"<the FULL revised LaTeX document, '
            "\\\\documentclass through \\\\end{document}, with the requested "
            'edit applied>\", \"rationale\": \"<one-sentence summary>\"}\n'
            "```\n"
            "The `latex` value MUST contain the COMPLETE document — never a "
            "diff hunk, never a partial snippet. Preserve all protected terms."
        )
    # repair
    return base + (
        "\nThe resume needs one repair iteration to satisfy the one-page rule "
        "AND to eliminate any horizontal overflow ('Overfull \\hbox') warnings. "
        "Respond with ONLY a single JSON object and nothing else "
        "(no markdown fences, no commentary), matching this schema exactly:\n"
        '{"diff": "<full revised LaTeX document>", '
        '"removed_terms": ["..."], '
        '"rationale": "<short explanation>"}\n'
        "The `diff` field MUST contain the COMPLETE revised LaTeX document "
        "(not a unified-diff hunk). `removed_terms` must list any terms you "
        "dropped; it MUST NOT contain any protected term.\n\n"
        "ATS protection — protected_terms are ATS keywords, action verbs, and "
        "domain-specific technical terms. NEVER remove or rephrase them away. "
        "Tighten by removing filler words ('successfully', 'efficiently', "
        "'in order to', 'various', 'helped', 'responsible for'), weak "
        "adjectives, redundant phrasing, and articles where natural — never "
        "by dropping ATS keywords or replacing strong action verbs with weaker "
        "synonyms.\n\n"
        "Bullet density rules — short stubby bullets look worse than the "
        "overflow itself:\n"
        "- When shrinking, PREFER dropping a whole bullet (or merging two "
        "weak ones into one strong one) over leaving a half-line stub.\n"
        "- Every remaining bullet should render as a single line that fills "
        "~90-100% of the column (~95-115 chars). Avoid bullets shorter than "
        "~85 characters.\n"
        "- Never wrap a bullet to two lines.\n"
        "- A bullet that overflows the right margin by even 1-2pt is a defect: "
        "it produces a wrapped second line with one or two orphaned words, "
        "which looks unprofessional and wastes vertical space. Tighten such "
        "bullets so they fit cleanly on one line."
    )


_JSON_OBJECT_RE = re.compile(r"\{.*\}", re.DOTALL)


def _extract_json_object(raw: str) -> str:
    """Best-effort extraction of a JSON object from model output.

    Strips ```json/``` fences and, if the result still isn't pure JSON, falls
    back to the first ``{...}`` span. Returns the trimmed candidate string.
    """
    text = raw.strip()
    if text.startswith("```"):
        text = "\n".join(
            line for line in text.splitlines() if not line.startswith("```")
        ).strip()
    if text.startswith("{"):
        return text
    match = _JSON_OBJECT_RE.search(text)
    return match.group(0) if match else text


def _extract_text(msg: object) -> str:
    """Concatenate ``TextBlock`` text from an ``AssistantMessage``."""
    if not isinstance(msg, AssistantMessage):
        return ""
    parts: list[str] = []
    for block in msg.content:
        if isinstance(block, TextBlock):
            parts.append(block.text)
    return "".join(parts)


async def query_json(
    *,
    system_prompt: str,
    user_prompt: str,
    tier: ModelTier,
) -> dict:
    """Run a non-streaming query and parse a strict JSON envelope.

    Tolerates ```json fenced blocks. Raises ``AgentError`` on empty output or
    invalid JSON.
    """
    options = ClaudeAgentOptions(
        model=MODELS[tier],
        system_prompt=system_prompt,
    )
    collected: list[str] = []
    async for msg in query(prompt=user_prompt, options=options):
        text = _extract_text(msg)
        if text:
            collected.append(text)
    raw = "".join(collected).strip()
    if not raw:
        raise AgentError("Model returned no text for query_json")
    candidate = _extract_json_object(raw)
    try:
        return json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise AgentError(f"invalid JSON: {exc}; got {raw[:200]}") from exc


async def query_text(
    *,
    system_prompt: str,
    user_prompt: str,
    tier: ModelTier,
) -> str:
    """Run a non-streaming query and return the concatenated text output.

    Used by short-form generation paths (cover letters, screener answers)
    that don't need a JSON envelope. Raises ``AgentError`` on empty output.
    """
    options = ClaudeAgentOptions(
        model=MODELS[tier],
        system_prompt=system_prompt,
    )
    collected: list[str] = []
    async for msg in query(prompt=user_prompt, options=options):
        text = _extract_text(msg)
        if text:
            collected.append(text)
    raw = "".join(collected).strip()
    if not raw:
        raise AgentError("Model returned no text for query_text")
    return raw


def _format_history(history: list[tuple[str, str]] | None) -> str:
    """Render prior chat turns as a plain transcript prefixed to the user prompt.

    The Agent SDK's ``query`` helper is one-shot, so to give the model
    multi-turn awareness we inline the recent turns. We only surface user
    instructions and the assistant's prose (any ```json envelope is stripped
    by the client before we ever store it here). Truncates to the last 8 turns
    and 8 KB to keep prompts bounded.
    """
    if not history:
        return ""
    turns = history[-8:]
    lines = ["Prior conversation (most recent last):"]
    for role, content in turns:
        label = "User" if role == "user" else "Assistant"
        snippet = content.strip()
        if len(snippet) > 1500:
            snippet = snippet[:1500] + "…"
        lines.append(f"{label}: {snippet}")
    block = "\n".join(lines)
    if len(block) > 8000:
        block = block[-8000:]
    return block + "\n\n"


async def edit_resume(
    *,
    current_latex: str,
    instruction: str,
    protected_terms: list[str],
    page_count_hint: int,
    tier: ModelTier = "haiku",
    history: list[tuple[str, str]] | None = None,
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
    history_block = _format_history(history)
    user_prompt = (
        f"{history_block}"
        f"Instruction:\n{instruction}\n\n"
        f"Current LaTeX source:\n```latex\n{current_latex}\n```\n"
    )
    async for msg in query(prompt=user_prompt, options=options):
        text = _extract_text(msg)
        if text:
            yield text


def _format_overflow_hints(hints: list[dict] | None) -> str:
    """Render overflow hints into a human/LLM-readable bullet list for the
    repair prompt. Each hint is a dict with overflow_pt, line_start, line_end,
    snippet (kept loose so callers can pass dataclasses or dicts)."""
    if not hints:
        return ""
    lines = [
        "Horizontal overflow warnings from the LaTeX compiler — these bullets "
        "currently spill past the right margin and wrap with 1-2 orphan words. "
        "Tighten ONLY these bullets (and any others you can see overflowing) "
        "by removing filler words; do not touch lines that already fit:"
    ]
    for h in hints[:20]:  # cap to keep prompts bounded
        snippet = (h.get("snippet") or "").strip()
        if len(snippet) > 220:
            snippet = snippet[:220] + "…"
        lines.append(
            f"- lines {h.get('line_start')}-{h.get('line_end')} "
            f"(over by {h.get('overflow_pt'):.1f}pt): {snippet or '(no snippet captured)'}"
        )
    return "\n".join(lines) + "\n\n"


async def repair_overflow(
    *,
    current_latex: str,
    last_diff: str,
    page_count: int,
    protected_terms: list[str],
    tier: ModelTier,
    overflow_hints: list[dict] | None = None,
) -> RepairResult:
    """One repair iteration. Non-streaming. Returns parsed JSON envelope.

    Raises ``AgentError`` if the model returns invalid JSON or violates
    protected terms.

    ``overflow_hints`` is an optional list of dicts (or dataclass instances
    coerced via ``__dict__``) carrying ``overflow_pt``, ``line_start``,
    ``line_end``, ``snippet``. When provided, the prompt instructs the model
    to also tighten the listed bullets so they fit on one line.
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
    if page_count > 1:
        situation = (
            f"The resume currently compiles to {page_count} pages and must fit "
            f"on exactly 1 page."
        )
    else:
        situation = (
            "The resume already fits on 1 page, but has horizontal-overflow "
            "warnings that must be resolved without growing it past 1 page."
        )
    user_prompt = (
        f"{situation}\n\n"
        f"{_format_overflow_hints(overflow_hints)}"
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
    candidate = _extract_json_object(raw)
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError as exc:
        print(
            f"[repair_overflow] JSON parse failure ({exc}); raw[:500]={raw[:500]!r}",
            file=sys.stderr,
        )
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
