"""SimplifyJobs README fetcher + parser.

SimplifyJobs maintains community-curated job lists in public GitHub repos:

    https://github.com/SimplifyJobs/New-Grad-Positions
    https://github.com/SimplifyJobs/Summer2025-Internships

Each repo's ``README.md`` contains markdown tables of postings. The
``apply_url`` in each row points to the underlying ATS posting (Greenhouse,
Lever, Ashby, Workable, or a company careers page), so postings ingested
via Simplify collapse against direct ATS ingestion through the existing
``(canonical_company, canonical_role_or_url)`` dedup in
``services.canonical``.

Simplify is a discovery-only source: it doesn't host application forms.
``matches_url`` is always ``False``; ``slug_from_url`` and ``fetch_one_url``
raise; ``probe_cover_letter`` delegates to whichever registered source owns
the underlying ``apply_url`` (and returns ``UNKNOWN`` if none does).

The slug is the repo name (e.g. ``"New-Grad-Positions"``).
"""

from __future__ import annotations

import hashlib
import re
from typing import Any

import httpx

from app.services.sources.protocol import CoverLetterRequirement, NormalizedPosting

__all__ = [
    "SimplifySource",
    "simplify_source",
    "SIMPLIFY_OWNER",
    "SIMPLIFY_RAW_URL_TEMPLATE",
]


SIMPLIFY_OWNER = "SimplifyJobs"
SIMPLIFY_RAW_URL_TEMPLATE = (
    "https://raw.githubusercontent.com/{owner}/{repo}/{branch}/README.md"
)
# SimplifyJobs repos auto-deploy from ``dev``; ``main`` is the GitHub default
# fallback. Tried in order.
_BRANCHES: tuple[str, ...] = ("dev", "main")


_TABLE_ROW_RE = re.compile(r"^\s*\|(.+)\|\s*$")
_SEPARATOR_RE = re.compile(r"^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$")
_HREF_HTML_RE = re.compile(r'<a\s+[^>]*href="([^"]+)"', re.I)
_HREF_MD_RE = re.compile(r"\[[^\]]*\]\((https?://[^)\s]+)\)")

# U+21B3 marks a sub-listing whose company is inherited from the row above.
_INHERIT_GLYPH = "↳"
# Cells containing any of these markers are treated as closed/expired.
_CLOSED_MARKERS = ("🔒",)


def _split_cells(row: str) -> list[str]:
    return [c.strip() for c in row.split("|")]


def _extract_apply_url(cell: str) -> str | None:
    m = _HREF_HTML_RE.search(cell)
    if m:
        return m.group(1)
    m = _HREF_MD_RE.search(cell)
    if m:
        return m.group(1)
    return None


def _strip_markdown(text: str) -> str:
    # [name](url) -> name
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    # Bare [name] (no url) -> name. Real SimplifyJobs rows occasionally use
    # this form for closed listings; handling it keeps the company name clean.
    text = re.sub(r"\[([^\]]+)\]", r"\1", text)
    text = re.sub(r"\*\*|\*|~~|`", "", text)
    return text.strip()


def _parse_company(cell: str, prev_company: str | None) -> str | None:
    raw = cell.strip()
    if not raw:
        return None
    if _INHERIT_GLYPH in raw:
        return prev_company
    plain = _strip_markdown(raw)
    if not plain or plain.lower() == "closed":
        return None
    return plain


def _parse_readme(text: str) -> list[NormalizedPosting]:
    """Walk every markdown table in ``text`` and return one posting per row."""
    out: list[NormalizedPosting] = []
    seen_urls: set[str] = set()
    lines = text.splitlines()
    in_table = False
    prev_company: str | None = None

    i = 0
    while i < len(lines):
        line = lines[i]
        if (
            not in_table
            and _TABLE_ROW_RE.match(line)
            and i + 1 < len(lines)
            and _SEPARATOR_RE.match(lines[i + 1])
        ):
            in_table = True
            prev_company = None
            i += 2
            continue

        if in_table:
            if not _TABLE_ROW_RE.match(line):
                in_table = False
                i += 1
                continue
            cells = _split_cells(line)
            if cells and cells[0] == "":
                cells = cells[1:]
            if cells and cells[-1] == "":
                cells = cells[:-1]
            if len(cells) < 4:
                i += 1
                continue
            company_cell, role_cell, location_cell, apply_cell = cells[:4]
            date_cell = cells[4] if len(cells) >= 5 else ""

            if any(marker in apply_cell for marker in _CLOSED_MARKERS):
                i += 1
                continue

            apply_url = _extract_apply_url(apply_cell)
            if apply_url is None:
                i += 1
                continue

            company = _parse_company(company_cell, prev_company)
            if company is None:
                i += 1
                continue
            prev_company = company

            role = _strip_markdown(role_cell)
            location = _strip_markdown(location_cell) or None
            date_posted = _strip_markdown(date_cell) or None

            if apply_url in seen_urls:
                i += 1
                continue
            seen_urls.add(apply_url)

            digest = hashlib.sha256(apply_url.encode("utf-8")).hexdigest()[:16]
            out.append(
                NormalizedPosting(
                    source_job_id=digest,
                    title=role or "",
                    location=location,
                    apply_url=apply_url,
                    description_html=None,
                    description_text=f"{role} at {company}".strip(),
                    meta={
                        "simplify_company": company,
                        "simplify_date_posted": date_posted,
                    },
                )
            )
        i += 1

    return out


async def _fetch_readme(repo: str, *, http: httpx.AsyncClient) -> str | None:
    """Try each branch in order; return the first 200 body or ``None`` on 404s."""
    for branch in _BRANCHES:
        url = SIMPLIFY_RAW_URL_TEMPLATE.format(
            owner=SIMPLIFY_OWNER, repo=repo, branch=branch
        )
        resp = await http.get(url)
        if resp.status_code == 200:
            return resp.text
        if resp.status_code == 404:
            continue
        resp.raise_for_status()
    return None


class SimplifySource:
    """:class:`Source` adapter for SimplifyJobs community-curated repos."""

    name = "simplify"
    tos_risk = "clean"

    async def fetch_company_postings(
        self, slug: str, *, http: httpx.AsyncClient
    ) -> list[NormalizedPosting]:
        text = await _fetch_readme(slug, http=http)
        if text is None:
            return []
        return _parse_readme(text)

    def matches_url(self, url: str) -> bool:
        return False

    def slug_from_url(self, url: str) -> str:
        raise ValueError(
            f"simplify is discovery-only; cannot extract slug from {url!r}"
        )

    async def fetch_one_url(
        self, url: str, *, http: httpx.AsyncClient
    ) -> NormalizedPosting:
        raise ValueError(
            f"simplify is discovery-only; paste the underlying ATS URL instead: {url!r}"
        )

    async def probe_cover_letter(
        self,
        posting_meta: dict[str, Any],
        apply_url: str,
        *,
        http: httpx.AsyncClient,
    ) -> CoverLetterRequirement:
        # Delegate to whichever registered source owns the underlying URL.
        # Imported here to avoid a circular import at module load.
        from app.services.sources import SOURCES

        for source in SOURCES.values():
            if source.name == self.name:
                continue
            try:
                if source.matches_url(apply_url):
                    return await source.probe_cover_letter(
                        posting_meta, apply_url, http=http
                    )
            except Exception:
                continue
        return CoverLetterRequirement.UNKNOWN


simplify_source = SimplifySource()
