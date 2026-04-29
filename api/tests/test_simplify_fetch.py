"""SimplifyJobs source adapter unit tests.

Mirrors ``test_lever_fetch.py`` shape — an ``httpx.MockTransport`` is
injected so no real network traffic happens. Covers README parsing,
``↳`` company inheritance, closed-row skipping, branch fallback (dev →
main), URL ownership semantics, and the cover-letter probe delegation
to whichever underlying source owns the apply_url.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from app.services.sources.protocol import CoverLetterRequirement
from app.services.sources.simplify import (
    SIMPLIFY_OWNER,
    SIMPLIFY_RAW_URL_TEMPLATE,
    SimplifySource,
    _parse_readme,
    simplify_source,
)


_BASIC_README = """\
# New Grad Positions

| Company | Role | Location | Application/Link | Date Posted |
| --- | --- | --- | --- | --- |
| **[Stripe](https://stripe.com)** | Software Engineer | New York, NY | <a href="https://job-boards.greenhouse.io/stripe/jobs/12345"><img src="apply.svg"/></a> | Apr 27 |
| ↳ |  | San Francisco, CA | <a href="https://job-boards.greenhouse.io/stripe/jobs/67890">Apply</a> | Apr 27 |
| **[Anthropic](https://anthropic.com)** | Member of Technical Staff | Remote | [Apply](https://boards.greenhouse.io/anthropic/jobs/4567) | Apr 26 |
| **[OldCo]** | ~~Backend~~ | ~~SF~~ | 🔒 | Apr 1 |
| **[NoLink]** | Engineer | NYC |  | Apr 25 |
"""


def _make_client(
    *,
    responses: dict[str, tuple[int, str]] | None = None,
    capture: list[httpx.Request] | None = None,
) -> httpx.AsyncClient:
    """Build an httpx client whose responses are keyed by request URL.

    Any URL not in ``responses`` returns 404. This lets tests script the
    branch-fallback chain (e.g. dev → 404, main → 200).
    """
    responses = responses or {}

    def handler(request: httpx.Request) -> httpx.Response:
        if capture is not None:
            capture.append(request)
        url = str(request.url)
        if url in responses:
            status, body = responses[url]
            return httpx.Response(status, content=body.encode("utf-8"))
        return httpx.Response(404, content=b"not found")

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _raw_url(repo: str, branch: str) -> str:
    return SIMPLIFY_RAW_URL_TEMPLATE.format(
        owner=SIMPLIFY_OWNER, repo=repo, branch=branch
    )


# --- README parsing ---------------------------------------------------------


def test_parse_readme_normalizes_basic_rows():
    out = _parse_readme(_BASIC_README)

    # Three valid postings: Stripe NY, Stripe SF (↳ inherits), Anthropic.
    # OldCo (🔒) and NoLink (no href) are skipped.
    assert len(out) == 3

    stripe_ny, stripe_sf, anthropic = out

    assert stripe_ny["title"] == "Software Engineer"
    assert stripe_ny["location"] == "New York, NY"
    assert stripe_ny["apply_url"] == "https://job-boards.greenhouse.io/stripe/jobs/12345"
    assert stripe_ny["meta"]["simplify_company"] == "Stripe"
    assert stripe_ny["meta"]["simplify_date_posted"] == "Apr 27"
    assert stripe_ny["description_html"] is None
    assert "Software Engineer" in stripe_ny["description_text"]
    assert "Stripe" in stripe_ny["description_text"]

    # ↳ row inherits "Stripe" as its company.
    assert stripe_sf["meta"]["simplify_company"] == "Stripe"
    assert stripe_sf["location"] == "San Francisco, CA"
    assert stripe_sf["apply_url"] == "https://job-boards.greenhouse.io/stripe/jobs/67890"

    # Markdown-link [Apply](url) form also works.
    assert anthropic["meta"]["simplify_company"] == "Anthropic"
    assert anthropic["apply_url"] == "https://boards.greenhouse.io/anthropic/jobs/4567"


def test_parse_readme_source_job_id_is_stable_hash_of_url():
    out = _parse_readme(_BASIC_README)
    # Same URL parsed twice → same source_job_id.
    again = _parse_readme(_BASIC_README)
    for a, b in zip(out, again):
        assert a["source_job_id"] == b["source_job_id"]
    # Different URLs → different ids.
    assert len({p["source_job_id"] for p in out}) == len(out)


def test_parse_readme_dedups_repeated_apply_urls():
    readme = """\
| Company | Role | Location | Link | Date |
| --- | --- | --- | --- | --- |
| **[A]** | Eng | NYC | <a href="https://example.com/apply/1">Apply</a> | Apr 27 |
| **[B]** | Eng | SF | <a href="https://example.com/apply/1">Apply</a> | Apr 27 |
"""
    out = _parse_readme(readme)
    assert len(out) == 1
    assert out[0]["meta"]["simplify_company"] == "A"


def test_parse_readme_handles_multiple_tables():
    readme = """\
## Software Engineering

| Company | Role | Location | Link | Date |
| --- | --- | --- | --- | --- |
| **[A]** | SWE | NYC | <a href="https://example.com/a">Apply</a> | Apr 27 |

## Data Science

| Company | Role | Location | Link | Date |
| --- | --- | --- | --- | --- |
| **[B]** | DS | SF | <a href="https://example.com/b">Apply</a> | Apr 26 |
"""
    out = _parse_readme(readme)
    assert [p["meta"]["simplify_company"] for p in out] == ["A", "B"]


def test_parse_readme_returns_empty_when_no_table():
    assert _parse_readme("# Just prose\n\nNothing to see.\n") == []


def test_parse_readme_inherit_glyph_with_no_prior_company_skips_row():
    readme = """\
| Company | Role | Location | Link | Date |
| --- | --- | --- | --- | --- |
| ↳ | Eng | NYC | <a href="https://example.com/x">Apply</a> | Apr 27 |
| **[B]** | Eng | SF | <a href="https://example.com/y">Apply</a> | Apr 27 |
"""
    out = _parse_readme(readme)
    assert [p["meta"]["simplify_company"] for p in out] == ["B"]


# --- fetch_company_postings + branch fallback -------------------------------


@pytest.mark.asyncio
async def test_fetch_company_postings_uses_dev_branch_first():
    captured: list[httpx.Request] = []
    async with _make_client(
        responses={_raw_url("New-Grad-Positions", "dev"): (200, _BASIC_README)},
        capture=captured,
    ) as http:
        out = await simplify_source.fetch_company_postings(
            "New-Grad-Positions", http=http
        )

    assert len(out) == 3
    # Only the dev URL was requested (no fallback needed).
    assert [str(r.url) for r in captured] == [_raw_url("New-Grad-Positions", "dev")]


@pytest.mark.asyncio
async def test_fetch_company_postings_falls_back_to_main_on_404():
    captured: list[httpx.Request] = []
    async with _make_client(
        responses={_raw_url("New-Grad-Positions", "main"): (200, _BASIC_README)},
        capture=captured,
    ) as http:
        out = await simplify_source.fetch_company_postings(
            "New-Grad-Positions", http=http
        )

    assert len(out) == 3
    # Both branches probed in order.
    assert [str(r.url) for r in captured] == [
        _raw_url("New-Grad-Positions", "dev"),
        _raw_url("New-Grad-Positions", "main"),
    ]


@pytest.mark.asyncio
async def test_fetch_company_postings_returns_empty_when_all_branches_404():
    async with _make_client(responses={}) as http:
        out = await simplify_source.fetch_company_postings(
            "Nonexistent-Repo", http=http
        )
    assert out == []


@pytest.mark.asyncio
async def test_fetch_company_postings_raises_on_5xx():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, content=b"boom")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(httpx.HTTPStatusError):
            await simplify_source.fetch_company_postings("Anything", http=http)


# --- URL semantics ----------------------------------------------------------


def test_matches_url_always_false():
    s = SimplifySource()
    # Even URLs that look "simplify-y" shouldn't match — Simplify is a
    # discovery source, not a hoster of posting URLs.
    assert s.matches_url("https://github.com/SimplifyJobs/New-Grad-Positions") is False
    assert s.matches_url("https://simplify.jobs/anything") is False
    assert s.matches_url("https://boards.greenhouse.io/stripe/jobs/1") is False
    assert s.matches_url("not a url") is False


def test_slug_from_url_always_raises():
    s = SimplifySource()
    with pytest.raises(ValueError):
        s.slug_from_url("https://github.com/SimplifyJobs/New-Grad-Positions")


@pytest.mark.asyncio
async def test_fetch_one_url_always_raises():
    s = SimplifySource()

    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("HTTP must not be called for fetch_one_url")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(ValueError):
            await s.fetch_one_url(
                "https://github.com/SimplifyJobs/New-Grad-Positions", http=http
            )


# --- probe_cover_letter delegation -----------------------------------------


@pytest.mark.asyncio
async def test_probe_cover_letter_delegates_to_underlying_source(monkeypatch):
    """A simplify posting whose apply_url is greenhouse must invoke the
    greenhouse probe — we don't want to mark every simplify posting UNKNOWN
    when the underlying source can give us a real answer."""

    calls: list[tuple[str, str]] = []

    async def fake_probe(
        self: Any,
        posting_meta: dict[str, Any],
        apply_url: str,
        *,
        http: httpx.AsyncClient,
    ) -> CoverLetterRequirement:
        calls.append((self.name, apply_url))
        return CoverLetterRequirement.OPTIONAL

    # Patch the greenhouse adapter's probe.
    from app.services.sources.greenhouse import GreenhouseSource

    monkeypatch.setattr(GreenhouseSource, "probe_cover_letter", fake_probe)

    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        # The fake probe is invoked instead of any real network call; if
        # this handler runs the test should fail loudly.
        raise AssertionError("delegated probe should not hit the network")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        result = await simplify_source.probe_cover_letter(
            {}, "https://boards.greenhouse.io/anthropic/jobs/4567", http=http
        )

    assert result is CoverLetterRequirement.OPTIONAL
    assert calls == [("greenhouse", "https://boards.greenhouse.io/anthropic/jobs/4567")]


@pytest.mark.asyncio
async def test_probe_cover_letter_unknown_when_no_underlying_source_matches():
    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("no source should match → no probe call")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        result = await simplify_source.probe_cover_letter(
            {}, "https://example.com/some-careers-page/job/1", http=http
        )

    assert result is CoverLetterRequirement.UNKNOWN


# --- Registry membership ----------------------------------------------------


def test_registered_in_sources():
    from app.services.sources import SOURCES
    from app.services.sources.protocol import Source

    assert "simplify" in SOURCES
    assert SOURCES["simplify"] is simplify_source
    assert isinstance(simplify_source, Source)
    assert simplify_source.name == "simplify"
    assert simplify_source.tos_risk == "clean"
