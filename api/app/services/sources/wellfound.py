"""Wellfound (formerly AngelList Talent) source adapter (Playwright scrape).

Wellfound's company job pages live at ``wellfound.com/company/{slug}/jobs``
and individual postings at ``wellfound.com/jobs/{id}-{slugified-title}``.
The site is a Next.js SPA so we drive Playwright. ``tos_risk="high"``.
"""

from __future__ import annotations

import re
from typing import Any, Awaitable, Callable
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

from app.services.sources.protocol import CoverLetterRequirement, NormalizedPosting

__all__ = ["WellfoundSource", "wellfound_source", "WELLFOUND_BASE"]


WELLFOUND_BASE = "https://wellfound.com"

_WF_HOSTS = {"wellfound.com", "www.wellfound.com"}
_JOB_PATH_RE = re.compile(r"^/jobs/(?P<jid>\d+)(?:-[^/]*)?/?$")
_COMPANY_PATH_RE = re.compile(
    r"^/company/(?P<slug>[a-z0-9\-]+)(?:/jobs)?/?$", re.I
)


PageFactory = Callable[[], Awaitable[Any]]


def _parse_company_html(html: str) -> list[NormalizedPosting]:
    soup = BeautifulSoup(html, "html.parser")
    out: list[NormalizedPosting] = []
    seen: set[str] = set()
    for card in soup.select("[data-test='JobSearchCard']"):
        link = card.select_one("[data-test='job-title-link']")
        if not link:
            continue
        href = link.get("href") or ""
        m = re.match(r"^/jobs/(\d+)", href)
        if not m:
            continue
        jid = m.group(1)
        if jid in seen:
            continue
        seen.add(jid)
        title = link.get_text(strip=True)
        loc_node = card.select_one("[data-test='JobLocation']")
        location = loc_node.get_text(strip=True) if loc_node else None
        apply_url = (
            href if href.startswith("http") else WELLFOUND_BASE + href
        )
        out.append(
            NormalizedPosting(
                source_job_id=jid,
                title=title,
                location=location,
                apply_url=apply_url,
                description_html=None,
                description_text="",
                meta={"wellfound_id": jid},
            )
        )
    return out


def _parse_view_html(html: str, *, jid: str, url: str) -> NormalizedPosting:
    soup = BeautifulSoup(html, "html.parser")
    title_node = soup.select_one("[data-test='JobTitle']")
    loc_node = soup.select_one("[data-test='JobLocation']")
    desc_node = soup.select_one("[data-test='JobDescription']")
    title = title_node.get_text(strip=True) if title_node else ""
    location = loc_node.get_text(strip=True) if loc_node else None
    description_html = str(desc_node) if desc_node else None
    description_text = desc_node.get_text("\n", strip=True) if desc_node else ""
    return NormalizedPosting(
        source_job_id=jid,
        title=title,
        location=location,
        apply_url=url,
        description_html=description_html,
        description_text=description_text,
        meta={"wellfound_id": jid},
    )


def _jid_from_url(url: str) -> str | None:
    try:
        p = urlparse(url)
    except ValueError:
        return None
    if (p.netloc or "").lower() not in _WF_HOSTS:
        return None
    m = _JOB_PATH_RE.match(p.path or "")
    return m.group("jid") if m else None


def _slug_from_url(url: str) -> str | None:
    try:
        p = urlparse(url)
    except ValueError:
        return None
    if (p.netloc or "").lower() not in _WF_HOSTS:
        return None
    m = _COMPANY_PATH_RE.match(p.path or "")
    return m.group("slug") if m else None


class WellfoundSource:
    """:class:`Source` adapter for Wellfound (Playwright scrape)."""

    name = "wellfound"
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
                f"{WELLFOUND_BASE}/company/{slug}/jobs",
                wait_until="domcontentloaded",
            )
            try:
                await page.wait_for_selector(
                    "[data-test='JobSearchCard']", timeout=10000
                )
            except Exception:
                pass
            html = await page.content()
        finally:
            await page.close()
        return _parse_company_html(html)

    def matches_url(self, url: str) -> bool:
        return _jid_from_url(url) is not None or _slug_from_url(url) is not None

    def slug_from_url(self, url: str) -> str:
        slug = _slug_from_url(url)
        if slug is None:
            raise ValueError(f"no company slug in wellfound URL: {url!r}")
        return slug

    async def fetch_one_url(  # type: ignore[override]
        self,
        url: str,
        *,
        http: httpx.AsyncClient | None = None,
        page_factory: PageFactory | None = None,
    ) -> NormalizedPosting:
        jid = _jid_from_url(url)
        if jid is None:
            raise ValueError(f"not a wellfound posting URL: {url!r}")
        if page_factory is None:
            page_factory = _default_page_factory
        page = await page_factory()
        try:
            await page.goto(url, wait_until="domcontentloaded")
            html = await page.content()
        finally:
            await page.close()
        return _parse_view_html(html, jid=jid, url=url)

    async def probe_cover_letter(
        self,
        posting_meta: dict[str, Any],
        apply_url: str,
        *,
        http: httpx.AsyncClient,
    ) -> CoverLetterRequirement:
        # Wellfound's apply form is rendered behind a Next.js SPA — no
        # cheap probe. Return UNKNOWN so prepare defaults to generating a CL.
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


wellfound_source = WellfoundSource()
