"""Canonical key for application-level dedup.

Given a (company, apply_url) pair, produce a stable identity string that
collapses trivial variation (corporate suffixes, tracking query params,
trailing slashes, casing). The resulting key feeds the unique
``ix_applications_user_canonical_key`` index so the same role posted on
multiple boards collapses to a single application row.
"""

from __future__ import annotations

import re
from urllib.parse import urlsplit, urlunsplit


# Common corporate suffixes. Matched as a trailing word with optional
# punctuation so "Foo, Inc." and "Foo Inc" both normalize to "foo".
_SUFFIX_RE = re.compile(
    r"[\s,\.]+(inc|llc|ltd|corp|co|corporation|company|gmbh|s\.?a\.?|plc)\.?$",
    re.IGNORECASE,
)
_WS_RE = re.compile(r"\s+")


def _normalize_company(company: str | None) -> str:
    if not company:
        return ""
    s = company.strip().lower()
    # Strip suffixes repeatedly (e.g. "Foo Holdings, Inc.").
    prev = None
    while prev != s:
        prev = s
        s = _SUFFIX_RE.sub("", s).rstrip(" ,.")
    s = _WS_RE.sub(" ", s).strip()
    return s


def _normalize_url(apply_url: str) -> str:
    parts = urlsplit(apply_url.strip().lower())
    scheme = parts.scheme
    netloc = parts.netloc
    path = parts.path.rstrip("/") or parts.path
    # Drop query and fragment entirely — utm_*, gh_jid, gh_src, etc. are
    # all tracking noise; preserving any of them defeats dedup.
    return urlunsplit((scheme, netloc, path, "", ""))


def canonicalize(company: str | None, apply_url: str) -> str:
    """Produce a stable identity key for application-level dedup.

    - Lowercase company; strip Inc/LLC/Ltd/Corp/Co (and similar) suffixes;
      collapse whitespace.
    - Lowercase apply_url; strip query params and fragments; strip trailing
      slashes; preserve path.
    - Return ``"{company_norm}::{url_norm}"``. When company is None or
      empty, return just the url_norm (no leading separator).
    """
    company_norm = _normalize_company(company)
    url_norm = _normalize_url(apply_url)
    if not company_norm:
        return url_norm
    return f"{company_norm}::{url_norm}"
