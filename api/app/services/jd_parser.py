"""Job description keyword extractor.

Uses Haiku 4.5 through the agent service to produce a canonical,
deduplicated, lowercased list of keywords/action verbs from a JD.
"""

from __future__ import annotations

from app.services.agent import AgentError, query_json

_SYSTEM = (
    "You extract canonical keywords and action verbs from a job description.\n"
    "Return ONLY a JSON object with this exact shape:\n"
    '{"keywords": ["keyword1", "keyword2", ...]}\n'
    "Rules:\n"
    "- Keep important technical terms (languages, frameworks, tools, platforms).\n"
    "- Keep strong action verbs (e.g., led, designed, optimized).\n"
    "- Drop filler words (the, and, etc.), generic phrases, and soft skills.\n"
    "- Return at most 30 items, lowercase, no duplicates.\n"
    "- No prose, no markdown fences, no commentary."
)


async def extract_keywords(*, raw_text: str) -> list[str]:
    """Return a lowercased, deduplicated list of JD keywords.

    Returns ``[]`` for empty/whitespace input without calling the model.
    Raises ``AgentError`` if the model returns an unexpected JSON shape.
    """
    if not raw_text.strip():
        return []
    data = await query_json(
        system_prompt=_SYSTEM,
        user_prompt=raw_text,
        tier="haiku",
    )
    if not isinstance(data, dict) or not isinstance(data.get("keywords"), list):
        raise AgentError(f"unexpected JSON shape: {data!r}")
    out: list[str] = []
    seen: set[str] = set()
    for k in data["keywords"]:
        if not isinstance(k, str):
            continue
        s = k.strip().lower()
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    return out
