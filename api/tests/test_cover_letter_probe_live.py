"""Live cover-letter probes — skipped by default.

Run with: ``docker compose run --rm api pytest -m live tests/test_cover_letter_probe_live.py -v``

These tests hit real third-party APIs and exist to catch silent shape drift
(Greenhouse/Lever/Workable/Ashby occasionally rename fields). They are
marked ``live`` and excluded from the default test run because:

- they make network calls, so they're flaky on offline laptops;
- the URLs may expire when the underlying postings close.

If a posting URL below 404s, swap it for any currently-open one from the
same source and re-run.
"""

from __future__ import annotations

import httpx
import pytest

from app.services.sources.ashby import ashby_source
from app.services.sources.greenhouse import greenhouse_source
from app.services.sources.lever import lever_source
from app.services.sources.protocol import CoverLetterRequirement
from app.services.sources.workable import workable_source

pytestmark = pytest.mark.live


@pytest.mark.asyncio
async def test_greenhouse_live_loop():
    url = "https://job-boards.greenhouse.io/loop/jobs/5981831004"
    async with httpx.AsyncClient() as http:
        result = await greenhouse_source.probe_cover_letter(
            {"slug": "loop"}, url, http=http,
        )
    assert result is not CoverLetterRequirement.UNKNOWN


@pytest.mark.asyncio
async def test_lever_live_smoke():
    # Lever's default apply page returns OPTIONAL even without applicationQuestions,
    # so any reachable Lever posting URL works as a smoke test.
    url = "https://jobs.lever.co/netflix/0000000-not-a-real-id"
    async with httpx.AsyncClient() as http:
        result = await lever_source.probe_cover_letter({}, url, http=http)
    # We don't assert a specific value — just that the probe didn't blow up
    # in an unexpected way.
    assert result in {
        CoverLetterRequirement.REQUIRED,
        CoverLetterRequirement.OPTIONAL,
        CoverLetterRequirement.NOT_PRESENT,
        CoverLetterRequirement.UNKNOWN,
    }


@pytest.mark.asyncio
async def test_workable_live_smoke():
    url = "https://apply.workable.com/example/j/00000000/"
    async with httpx.AsyncClient() as http:
        result = await workable_source.probe_cover_letter({}, url, http=http)
    assert result in {
        CoverLetterRequirement.REQUIRED,
        CoverLetterRequirement.OPTIONAL,
        CoverLetterRequirement.NOT_PRESENT,
        CoverLetterRequirement.UNKNOWN,
    }


@pytest.mark.asyncio
async def test_ashby_live_smoke():
    url = "https://jobs.ashbyhq.com/example/00000000-0000-0000-0000-000000000000"
    async with httpx.AsyncClient() as http:
        result = await ashby_source.probe_cover_letter({}, url, http=http)
    assert result in {
        CoverLetterRequirement.REQUIRED,
        CoverLetterRequirement.OPTIONAL,
        CoverLetterRequirement.NOT_PRESENT,
        CoverLetterRequirement.UNKNOWN,
    }
