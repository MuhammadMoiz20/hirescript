"""Agentic company-discovery service.

A daily background job calls :func:`propose_companies` with the current
``profile`` row and the existing ``companies`` allowlist. The agent runs
a Sonnet session with a web-search tool and returns a strict envelope::

    {
      "proposals": [
        {
          "source": "greenhouse" | "lever" | "ashby" | "workable" |
                    "linkedin" | "indeed" | "wellfound",
          "slug": "<board slug>",
          "display_name": "<human company name>",
          "rationale": "<one sentence>"
        },
        ...
      ]
    }

The runner validates each proposal by hitting
``SOURCES[source].fetch_company_postings(slug)`` — a slug that returns
zero postings is dropped silently so the user never sees an unverifiable
proposal. Verified proposals are inserted into ``companies`` with
``enabled=False`` and ``discovered_by="agent"``; the user reviews them in
the existing Companies admin page and toggles them on.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.services.agent import AgentError, query_json

log = logging.getLogger(__name__)


_SYSTEM_PROMPT = (
    "You are HireScript's company-discovery agent. Given the user's "
    "profile and the existing list of companies they already track, "
    "propose between 3 and 8 NEW companies that match the user's tier "
    "preferences and target role family. Only propose companies whose "
    "public job board is hosted on one of: greenhouse, lever, ashby, "
    "workable, linkedin, indeed, wellfound. Use the company's exact "
    "board slug (the path segment, not the display name).\n\n"
    "Respond with EXACTLY ONE JSON object and nothing else:\n"
    "{\n"
    "  \"proposals\": [\n"
    "    { \"source\": \"...\", \"slug\": \"...\", "
    "\"display_name\": \"...\", \"rationale\": \"...\" }\n"
    "  ]\n"
    "}\n"
)


async def propose_companies(
    *, profile: dict[str, Any], existing: list[dict[str, Any]]
) -> dict[str, Any]:
    """Run the discovery agent and return its parsed JSON envelope.

    Wraps :func:`app.services.agent.query_json` with a Sonnet tier and
    the discovery system prompt. Tests monkeypatch this function so no
    real model call happens under unit test.
    """
    user_prompt = json.dumps(
        {"profile": profile, "existing": existing}, default=str
    )
    try:
        out = await query_json(
            system_prompt=_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            tier="sonnet",
        )
    except AgentError:
        log.exception("discover_companies: model returned malformed envelope")
        return {"proposals": []}
    if not isinstance(out, dict):
        return {"proposals": []}
    proposals = out.get("proposals")
    if not isinstance(proposals, list):
        return {"proposals": []}
    return {"proposals": proposals}
