"""Scraper-source adapters return UNKNOWN for cover-letter probes.

LinkedIn / Indeed / Wellfound apply flows are dynamic, login-gated, or
SPA-rendered — there is no cheap public-API probe. The adapters return
UNKNOWN so the prepare runner defaults to generating a cover letter.

The intent is documented inline at each `probe_cover_letter` to flag the
choice as deliberate (not a TODO).
"""

from __future__ import annotations

import httpx
import pytest

from app.services.sources.indeed import indeed_source
from app.services.sources.linkedin import linkedin_source
from app.services.sources.protocol import CoverLetterRequirement
from app.services.sources.wellfound import wellfound_source


@pytest.mark.parametrize(
    "source,url",
    [
        (linkedin_source, "https://www.linkedin.com/jobs/view/12345"),
        (indeed_source, "https://www.indeed.com/viewjob?jk=abc"),
        (wellfound_source, "https://wellfound.com/jobs/12345-engineer"),
    ],
)
@pytest.mark.asyncio
async def test_scraper_sources_return_unknown(source, url):
    async with httpx.AsyncClient() as http:
        result = await source.probe_cover_letter({}, url, http=http)
    assert result is CoverLetterRequirement.UNKNOWN
