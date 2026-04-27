"""Static validation of the Greenhouse company allowlist.

We deliberately do not network-test slugs — Greenhouse may temporarily 404 a
valid slug; the fetcher tolerates that at runtime.
"""

from __future__ import annotations

import re

from app.services.sources.greenhouse_companies import GREENHOUSE_COMPANIES


_SLUG_RE = re.compile(r"^[a-z0-9-]+$")


def test_allowlist_is_non_empty():
    assert len(GREENHOUSE_COMPANIES) > 0


def test_allowlist_entries_are_2_tuples_of_non_empty_strings():
    for entry in GREENHOUSE_COMPANIES:
        assert isinstance(entry, tuple)
        assert len(entry) == 2
        slug, display = entry
        assert isinstance(slug, str) and slug
        assert isinstance(display, str) and display


def test_allowlist_slugs_are_unique():
    slugs = [slug for slug, _ in GREENHOUSE_COMPANIES]
    assert len(slugs) == len(set(slugs))


def test_allowlist_slugs_are_lowercase_alphanumeric_hyphen():
    for slug, _ in GREENHOUSE_COMPANIES:
        assert _SLUG_RE.match(slug), f"invalid slug: {slug!r}"
