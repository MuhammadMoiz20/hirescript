"""Dream-tier company research agent.

Runs once per dream-tier application: produces a structured brief on the
company, persisted to ``application_research`` and consumed (in a later
slice) by the tailor prompt + visible to the user in the application
drawer.

Output envelope::

    {
      "brief_md": "<markdown summary, 200-400 words>",
      "signals": {
        "recent_news": ["..."],
        "hiring_signals": ["..."],
        "people": ["..."]
      }
    }

Model defaults to Sonnet 4.6; a future opt-in flag can promote to Opus
for "Deep tailor" runs (per the AI phase rules).
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.services.agent import MODELS, AgentError, query_json

log = logging.getLogger(__name__)


_SYSTEM_PROMPT = (
    "You are HireScript's dream-company research agent. Given a job "
    "posting + the company name, produce a concise research brief the "
    "user can read before applying. Use any web search you have access "
    "to. Be specific; cite concrete signals (news, funding, recent "
    "hires) over generic platitudes.\n\n"
    "Respond with EXACTLY ONE JSON object and nothing else:\n"
    "{\n"
    "  \"brief_md\": \"<markdown, 200-400 words>\",\n"
    "  \"signals\": {\n"
    "    \"recent_news\": [\"...\"],\n"
    "    \"hiring_signals\": [\"...\"],\n"
    "    \"people\": [\"...\"]\n"
    "  }\n"
    "}\n"
)


DEFAULT_TIER = "sonnet"


async def research_company(
    *,
    posting: dict[str, Any],
    company: dict[str, Any],
    profile: dict[str, Any],
    deep: bool = False,
) -> dict[str, Any]:
    """Run the research agent and return its parsed JSON envelope."""
    user_prompt = json.dumps(
        {"posting": posting, "company": company, "profile": profile},
        default=str,
    )
    tier = "opus" if deep else DEFAULT_TIER
    try:
        out = await query_json(
            system_prompt=_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            tier=tier,
        )
    except AgentError:
        log.exception("dream_research: model returned malformed envelope")
        return {"brief_md": "", "signals": {}}
    if not isinstance(out, dict):
        return {"brief_md": "", "signals": {}}
    out.setdefault("brief_md", "")
    out.setdefault("signals", {})
    return out


def model_name(*, deep: bool = False) -> str:
    return MODELS["opus" if deep else DEFAULT_TIER]
