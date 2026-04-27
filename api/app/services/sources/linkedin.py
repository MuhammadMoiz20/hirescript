"""LinkedIn source adapter (Playwright scrape).

LinkedIn's job pages are JS-heavy and behind aggressive bot detection;
the public unauthenticated job listing is the only thing we can reliably
scrape, and even that requires a real browser to render the cards. We
mark this source ``tos_risk="high"`` so the UI badges it accordingly.

The adapter accepts an injected ``page_factory`` (an async callable
returning a Playwright-like ``Page``) so unit tests can inject a stub
that loads fixture HTML via ``set_content``. In production, the factory
spins up a real Chromium ``BrowserContext`` and returns a fresh page.
"""

from __future__ import annotations

import re
from typing import Any, Awaitable, Callable
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

from app.services.sources.protocol import NormalizedPosting

__all__ = ["LinkedInSource", "linkedin_source", "LINKEDIN_BASE"]


LINKEDIN_BASE = "https://www.linkedin.com"

_LINKEDIN_HOSTS = {"www.linkedin.com", "linkedin.com"}
_VIEW_PATH_RE = re.compile(r"^/jobs/view/(?P<jid>\d+)/?$")
_COMPANY_VIEW_PATH_RE = re.compile(
    r"^/company/(?P<slug>[a-z0-9\-]+)/jobs/view/(?P<jid>\d+)/?$", re.I
)


PageFactory = Callable[[], Awaitable[Any]]


def _parse_company_jobs_html(html: str) -> list[NormalizedPosting]:
    soup = BeautifulSoup(html, "html.parser")
    out: list[NormalizedPosting] = []
    seen: set[str] = set()
    for card in soup.select("a.base-card__full-link"):
        href = card.get("href") or ""
        m = re.search(r"/jobs/view/(\d+)", href)
        if not m:
            continue
        jid = m.group(1)
        if jid in seen:
            continue
        seen.add(jid)
        title_node = card.select_one("h3.base-search-card__title")
        loc_node = card.select_one("span.job-search-card__location")
        title = title_node.get_text(strip=True) if title_node else ""
        location = loc_node.get_text(strip=True) if loc_node else None
        out.append(
            NormalizedPosting(
                source_job_id=jid,
                title=title,
                location=location,
                apply_url=href.split("?")[0],
                description_html=None,
                description_text="",
                meta={"linkedin_id": jid},
            )
        )
    return out


def _parse_job_view_html(html: str, *, jid: str, url: str) -> NormalizedPosting:
    soup = BeautifulSoup(html, "html.parser")
    title_node = soup.select_one("h1.top-card-layout__title")
    loc_node = soup.select_one("span.topcard__flavor--bullet")
    desc_node = soup.select_one("div.show-more-less-html__markup")
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
        meta={"linkedin_id": jid},
    )


def _parse_url(url: str) -> tuple[str | None, str | None]:
    """Return ``(slug, job_id)`` if ``url`` looks like a LinkedIn job URL.

    ``slug`` is only present for the ``/company/{slug}/jobs/view/{id}``
    family — the bare ``/jobs/view/{id}`` URL has no derivable company
    slug (it requires a follow-up fetch).
    """
    try:
        p = urlparse(url)
    except ValueError:
        return None, None
    host = (p.netloc or "").lower()
    if host not in _LINKEDIN_HOSTS:
        return None, None
    path = p.path or ""
    m = _COMPANY_VIEW_PATH_RE.match(path)
    if m:
        return m.group("slug"), m.group("jid")
    m = _VIEW_PATH_RE.match(path)
    if m:
        return None, m.group("jid")
    return None, None


class LinkedInSource:
    """:class:`Source` adapter for LinkedIn jobs (Playwright scrape)."""

    name = "linkedin"
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
                f"{LINKEDIN_BASE}/company/{slug}/jobs/",
                wait_until="domcontentloaded",
            )
            try:
                await page.wait_for_selector(
                    "a.base-card__full-link", timeout=10000
                )
            except Exception:
                pass
            html = await page.content()
        finally:
            await page.close()
        return _parse_company_jobs_html(html)

    def matches_url(self, url: str) -> bool:
        slug, jid = _parse_url(url)
        return jid is not None

    def slug_from_url(self, url: str) -> str:
        slug, jid = _parse_url(url)
        if slug is None:
            raise ValueError(f"no company slug in linkedin URL: {url!r}")
        return slug

    async def fetch_one_url(  # type: ignore[override]
        self,
        url: str,
        *,
        http: httpx.AsyncClient | None = None,
        page_factory: PageFactory | None = None,
    ) -> NormalizedPosting:
        _, jid = _parse_url(url)
        if jid is None:
            raise ValueError(f"not a linkedin posting URL: {url!r}")
        if page_factory is None:
            page_factory = _default_page_factory
        page = await page_factory()
        try:
            await page.goto(url, wait_until="domcontentloaded")
            html = await page.content()
        finally:
            await page.close()
        return _parse_job_view_html(html, jid=jid, url=url)


async def _default_page_factory():  # pragma: no cover - real browser path
    from playwright.async_api import async_playwright

    pw = await async_playwright().start()
    browser = await pw.chromium.launch(headless=True)
    context = await browser.new_context()
    page = await context.new_page()
    # Attach cleanup so callers' ``page.close()`` tears the whole stack down.
    _orig_close = page.close

    async def _close():
        try:
            await _orig_close()
        finally:
            await context.close()
            await browser.close()
            await pw.stop()

    page.close = _close  # type: ignore[assignment]
    return page


linkedin_source = LinkedInSource()
