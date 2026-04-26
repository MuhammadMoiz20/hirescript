"""Allowlist of Greenhouse-hosted companies the scheduler ingests.

Slugs are the company subdomain on ``boards-api.greenhouse.io`` — i.e.
``https://boards-api.greenhouse.io/v1/boards/<slug>/jobs``. The display name
is the canonical brand string used in the UI.

Slug validity is verified at runtime by the fetcher; we do not network-test
slugs in unit tests because Greenhouse may temporarily 404 a valid slug.
"""

from __future__ import annotations


GREENHOUSE_COMPANIES: list[tuple[str, str]] = [
    ("anthropic", "Anthropic"),
    ("openai", "OpenAI"),
    ("stripe", "Stripe"),
    ("vercel", "Vercel"),
    ("linear", "Linear"),
    ("airbnb", "Airbnb"),
    ("databricks", "Databricks"),
    ("ramp", "Ramp"),
]
