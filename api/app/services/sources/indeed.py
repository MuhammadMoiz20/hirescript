"""Indeed source adapter (Playwright scrape).

Indeed serves company job listings at ``indeed.com/cmp/{slug}/jobs`` and
single postings at ``indeed.com/viewjob?jk={key}``. Both pages render
content client-side and are aggressively bot-detected, so we drive a
real Chromium via Playwright. ``tos_risk="high"``.

The adapter accepts an injected ``page_factory`` so tests can stub the
browser with fixture HTML — see ``app.services.sources.linkedin`` for
the same pattern.
"""

from __future__ import annotations

import re
from typing import Any, Awaitable, Callable
from urllib.parse import parse_qs, urlparse

import httpx
from bs4 import BeautifulSoup

from app.services.sources.protocol import CoverLetterRequirement, NormalizedPosting

__all__ = ["IndeedSource", "indeed_source", "INDEED_BASE"]


INDEED_BASE = "https://www.indeed.com"

_INDEED_HOSTS = {"www.indeed.com", "indeed.com"}
_CMP_PATH_RE = re.compile(r"^/cmp/(?P<slug>[a-z0-9\-]+)(?:/jobs)?/?$", re.I)


PageFactory = Callable[[], Awaitable[Any]]


def _parse_company_html(html: str) -> list[NormalizedPosting]:
    soup = BeautifulSoup(html, "html.parser")
    out: list[NormalizedPosting] = []
    seen: set[str] = set()
    for a in soup.select("a[data-jk]"):
        jk = a.get("data-jk") or ""
        if not jk or jk in seen:
            continue
        seen.add(jk)
        title_node = a.select_one("span[title]") or a
        title = (title_node.get("title") if hasattr(title_node, "get") else None) or title_node.get_text(strip=True)
        # location may be a sibling div
        loc = None
        parent = a.parent
        while parent is not None:
            loc_node = parent.select_one(".companyLocation") if hasattr(parent, "select_one") else None
            if loc_node:
                loc = loc_node.get_text(strip=True)
                break
            parent = getattr(parent, "parent", None)
        href = a.get("href") or f"/viewjob?jk={jk}"
        if href.startswith("/"):
            href = INDEED_BASE + href
        out.append(
            NormalizedPosting(
                source_job_id=jk,
                title=title,
                location=loc,
                apply_url=href,
                description_html=None,
                description_text="",
                meta={"indeed_jk": jk},
            )
        )
    return out


def _parse_view_html(html: str, *, jk: str, url: str) -> NormalizedPosting:
    soup = BeautifulSoup(html, "html.parser")
    title_node = soup.select_one("h1.jobsearch-JobInfoHeader-title")
    loc_node = soup.select_one("[data-testid='inlineHeader-companyLocation']")
    desc_node = soup.select_one("#jobDescriptionText")
    title = title_node.get_text(strip=True) if title_node else ""
    location = loc_node.get_text(strip=True) if loc_node else None
    description_html = str(desc_node) if desc_node else None
    description_text = desc_node.get_text("\n", strip=True) if desc_node else ""
    return NormalizedPosting(
        source_job_id=jk,
        title=title,
        location=location,
        apply_url=url,
        description_html=description_html,
        description_text=description_text,
        meta={"indeed_jk": jk},
    )


def _jk_from_url(url: str) -> str | None:
    try:
        p = urlparse(url)
    except ValueError:
        return None
    if (p.netloc or "").lower() not in _INDEED_HOSTS:
        return None
    if p.path != "/viewjob":
        return None
    qs = parse_qs(p.query or "")
    jks = qs.get("jk") or []
    return jks[0] if jks else None


def _slug_from_url(url: str) -> str | None:
    try:
        p = urlparse(url)
    except ValueError:
        return None
    if (p.netloc or "").lower() not in _INDEED_HOSTS:
        return None
    m = _CMP_PATH_RE.match(p.path or "")
    return m.group("slug") if m else None


class IndeedSource:
    """:class:`Source` adapter for Indeed (Playwright scrape)."""

    name = "indeed"
    tos_risk = "high"

    async def fetch_company_postings(  # type: ignore[override]
        self,
        slug: str,
        *,
        http: httpx.AsyncClient | None = None,
        page_factory: PageFactory | None = None,
    ) -> list[NormalizedPosting]:
        if page_factory is None:
            page_factory = _default_page_factory
        page = await page_factory()
        try:
            await page.goto(
                f"{INDEED_BASE}/cmp/{slug}/jobs",
                wait_until="domcontentloaded",
            )
            try:
                await page.wait_for_selector("a[data-jk]", timeout=10000)
            except Exception:
                pass
            html = await page.content()
        finally:
            await page.close()
        return _parse_company_html(html)

    def matches_url(self, url: str) -> bool:
        return _jk_from_url(url) is not None or _slug_from_url(url) is not None

    def slug_from_url(self, url: str) -> str:
        slug = _slug_from_url(url)
        if slug is None:
            raise ValueError(f"no company slug in indeed URL: {url!r}")
        return slug

    async def fetch_one_url(  # type: ignore[override]
        self,
        url: str,
        *,
        http: httpx.AsyncClient | None = None,
        page_factory: PageFactory | None = None,
    ) -> NormalizedPosting:
        jk = _jk_from_url(url)
        if jk is None:
            raise ValueError(f"not an indeed viewjob URL: {url!r}")
        if page_factory is None:
            page_factory = _default_page_factory
        page = await page_factory()
        try:
            await page.goto(url, wait_until="domcontentloaded")
            html = await page.content()
        finally:
            await page.close()
        return _parse_view_html(html, jk=jk, url=url)

    async def probe_cover_letter(
        self,
        posting_meta: dict[str, Any],
        apply_url: str,
        *,
        http: httpx.AsyncClient,
    ) -> CoverLetterRequirement:
        # Indeed apply forms are dynamic and gated behind login — no cheap
        # probe. Return UNKNOWN so prepare defaults to generating a CL.
        return CoverLetterRequirement.UNKNOWN


async def _default_page_factory():  # pragma: no cover - real browser path
    from playwright.async_api import async_playwright

    pw = await async_playwright().start()
    browser = await pw.chromium.launch(headless=True)
    context = await browser.new_context()
    page = await context.new_page()
    _orig = page.close

    async def _close():
        try:
            await _orig()
        finally:
            await context.close()
            await browser.close()
            await pw.stop()

    page.close = _close  # type: ignore[assignment]
    return page


indeed_source = IndeedSource()
