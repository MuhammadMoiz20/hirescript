"""Shared Playwright submit adapter scaffolding.

The Greenhouse adapter (``greenhouse.py``) shipped with all of its choreography
inlined. As soon as we added Lever / Ashby / Workable adapters with the same
shape, copy-pasting ~400 lines of identical orchestration per ATS would
guarantee drift the first time we tweak the captcha heuristic, the
confirmation regex, or the screenshot path layout.

This module factors out the shared pieces:

- :func:`first_visible` / :func:`fill_if_present` — selector-fallback helpers.
- :func:`detect_captcha` — the same captcha selector list used by every adapter.
- :func:`drive_form` — the navigate-fill-upload-submit-confirm choreography
  expressed against a per-ATS :class:`AdapterSpec`.

Per-ATS modules just declare an :class:`AdapterSpec` (selectors, required
fields, confirmation heuristic) and call :func:`drive_form`. This keeps the
``submit(ctx, on_progress)`` contract identical to Greenhouse's while collapsing
each new adapter to ~80 lines of declarative config.

Re-exports the Greenhouse exception classes so per-ATS modules can raise the
same types the runner already knows how to catch.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

# Re-use Greenhouse's exception types and TypedDicts so the runner does not
# need to learn per-ATS error classes.
from app.services.submit_adapters.greenhouse import (
    CaptchaContext,
    CaptchaPauseRequired,
    ConfirmationTimeoutError,
    MissingFieldError,
    SubmitContext,
    SubmitResult,
)

logger = logging.getLogger(__name__)


_DEFAULT_SCREENSHOT_DIR = "/app/compiled_pdfs/submit_screenshots"
_NAV_TIMEOUT_MS = 30_000
_CONFIRM_TIMEOUT_MS = 60_000

# Captcha heuristic — the same set Greenhouse uses; ATS-agnostic.
_CAPTCHA_SELECTORS: list[str] = [
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    'iframe[title*="captcha"]',
    '[data-testid*="captcha"]',
    "text=/are you human/i",
]


@dataclass
class AdapterSpec:
    """Per-ATS selector + heuristic bundle consumed by :func:`drive_form`.

    ``selectors`` keys are the canonical field names the runner already builds
    into a ``SubmitContext`` (``first_name``, ``last_name``, ``email``, ...).
    Each value is an ordered fallback list — the adapter walks them and picks
    the first match. The two well-known special keys are ``resume_upload``
    (driven via ``set_input_files``) and ``submit_button`` (clicked).

    ``required`` is the set of field names whose absence raises
    :class:`MissingFieldError`. Anything else is best-effort.

    ``confirmation_js`` is a raw JS predicate evaluated in
    ``page.wait_for_function``. It must return truthy when EITHER a
    success/thank-you signal is present OR a captcha element is present —
    the post-wait check disambiguates with :func:`detect_captcha`.

    ``pre_submit`` and ``post_fill`` are optional async hooks for ATS-specific
    quirks (e.g. Workable's two-step "upload then review" flow), invoked with
    ``(page, ctx)``. They MUST NOT raise on best-effort gaps; reserve raises
    for hard failures the runner should surface.
    """

    name: str
    selectors: dict[str, list[str]]
    required: set[str]
    confirmation_js: str
    captcha_selectors: list[str] = field(default_factory=lambda: list(_CAPTCHA_SELECTORS))
    pre_submit: Callable[[Any, SubmitContext], Awaitable[None]] | None = None
    post_fill: Callable[[Any, SubmitContext], Awaitable[None]] | None = None
    nav_timeout_ms: int = _NAV_TIMEOUT_MS
    confirm_timeout_ms: int = _CONFIRM_TIMEOUT_MS


async def emit(
    on_progress: Callable[[dict[str, Any]], Awaitable[None]] | None,
    phase: str,
    **data: Any,
) -> None:
    """Best-effort progress callback — never raises into the adapter."""
    if on_progress is None:
        return
    try:
        await on_progress({"phase": phase, **data})
    except Exception:  # noqa: BLE001
        logger.exception("on_progress callback raised for phase %s", phase)


async def first_visible(page: Any, selectors: list[str]) -> Any | None:
    """Return the first matching locator (uses ``count() > 0`` like Greenhouse)."""
    for sel in selectors:
        loc = page.locator(sel).first
        try:
            if await loc.count() > 0:
                return loc
        except Exception:  # noqa: BLE001
            continue
    return None


async def fill_if_present(
    page: Any,
    spec: AdapterSpec,
    field: str,
    value: str,
    on_progress: Callable[[dict[str, Any]], Awaitable[None]] | None,
) -> bool:
    if not value:
        return False
    selectors = spec.selectors.get(field, [])
    loc = await first_visible(page, selectors)
    if loc is None:
        return False
    try:
        await loc.fill(value)
    except Exception:  # noqa: BLE001
        try:
            await loc.click()
            await loc.type(value)
        except Exception:  # noqa: BLE001
            return False
    await emit(on_progress, "filling_field", field=field)
    return True


async def detect_captcha(page: Any, selectors: list[str]) -> bool:
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            if await loc.count() > 0:
                return True
        except Exception:  # noqa: BLE001
            continue
    return False


async def drive_form(
    spec: AdapterSpec,
    ctx: SubmitContext,
    on_progress: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    *,
    screenshot_dir: str | None = None,
    on_captcha: Callable[[CaptchaContext], Awaitable[None]] | None = None,
) -> SubmitResult:
    """Run the standard ATS submit choreography against ``spec``.

    Mirrors :func:`app.services.submit_adapters.greenhouse.submit`'s flow:
    navigate -> fill canonical fields -> upload resume -> optional cover
    letter -> spec-specific ``post_fill`` hook -> validate required ->
    optional ``pre_submit`` hook -> click submit -> wait for confirmation
    -> capture artifacts. Captcha and timeout paths exactly match Greenhouse's
    behavior so the runner's existing handlers apply unchanged.
    """
    from playwright.async_api import (
        TimeoutError as PlaywrightTimeoutError,
        async_playwright,
    )

    out_dir = screenshot_dir or _DEFAULT_SCREENSHOT_DIR
    os.makedirs(out_dir, exist_ok=True)

    filled: set[str] = set()

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            context = await browser.new_context()
            page = await context.new_page()

            await emit(on_progress, "nav_to_form", url=ctx["posting_apply_url"])
            await page.goto(
                ctx["posting_apply_url"], timeout=spec.nav_timeout_ms
            )

            # Canonical text fields.
            field_values: dict[str, str] = {
                "first_name": ctx.get("profile_first_name", ""),
                "last_name": ctx.get("profile_last_name", ""),
                "full_name": (
                    f"{ctx.get('profile_first_name', '')} "
                    f"{ctx.get('profile_last_name', '')}"
                ).strip(),
                "email": ctx.get("profile_email", ""),
                "phone": ctx.get("profile_phone", ""),
                "linkedin": (ctx.get("profile_links") or {}).get("linkedin", ""),
                "github": (ctx.get("profile_links") or {}).get("github", ""),
                "website": (ctx.get("profile_links") or {}).get("site", ""),
            }
            for field, value in field_values.items():
                if await fill_if_present(page, spec, field, value, on_progress):
                    filled.add(field)

            # Cover letter (optional, by convention key cover_letter_textarea).
            cover = ctx.get("cover_letter_text", "") or ""
            if cover and "cover_letter_textarea" in spec.selectors:
                if await fill_if_present(
                    page, spec, "cover_letter_textarea", cover, on_progress
                ):
                    filled.add("cover_letter_textarea")

            # Resume upload (required for every ATS we ship today).
            if "resume_upload" in spec.selectors:
                resume_loc = await first_visible(
                    page, spec.selectors["resume_upload"]
                )
                if resume_loc is not None:
                    resume_path = ctx["resume_pdf_path"]
                    await resume_loc.set_input_files(resume_path)
                    filled.add("resume_upload")
                    await emit(
                        on_progress, "uploaded_resume", path=resume_path
                    )

            # ATS-specific second-step / parsed-form review hook. May
            # advance the page (e.g. Workable's two-step flow) and surface
            # fields that didn't exist during the first canonical pass; we
            # re-walk the canonical fields after it runs so the
            # required-fields gate sees the post-advance state.
            if spec.post_fill is not None:
                await spec.post_fill(page, ctx)
                for field, value in field_values.items():
                    if field in filled:
                        continue
                    if await fill_if_present(page, spec, field, value, on_progress):
                        filled.add(field)

            # Extra label-matched answers — best-effort.
            known_keys = set(spec.selectors.keys()) | {
                "first_name", "last_name", "full_name", "email", "phone",
                "linkedin", "github", "website", "cover_letter_textarea",
            }
            for question, answer in (ctx.get("form_payload") or {}).items():
                if not answer or question in known_keys:
                    continue
                try:
                    loc = page.get_by_label(question, exact=False).first
                    if await loc.count() > 0:
                        await loc.fill(str(answer))
                        await emit(
                            on_progress, "filling_field", field=question
                        )
                except Exception:  # noqa: BLE001
                    logger.debug(
                        "no label match for extra field %r", question
                    )

            submit_loc = await first_visible(
                page, spec.selectors.get("submit_button", [])
            )
            if submit_loc is not None:
                filled.add("submit_button")

            missing = spec.required - filled
            if missing:
                raise MissingFieldError(sorted(missing)[0])

            if spec.pre_submit is not None:
                await spec.pre_submit(page, ctx)

            await emit(on_progress, "submitting")
            await submit_loc.click()

            ts = datetime.now(timezone.utc)
            screenshot_name = (
                f"{ctx['application_id']}_{int(ts.timestamp())}.png"
            )
            screenshot_path = os.path.join(out_dir, screenshot_name)

            try:
                await page.wait_for_function(
                    spec.confirmation_js,
                    timeout=spec.confirm_timeout_ms,
                )
            except PlaywrightTimeoutError as exc:
                try:
                    timeout_html = await page.content()
                except Exception:  # noqa: BLE001
                    timeout_html = ""
                try:
                    timeout_url = page.url
                except Exception:  # noqa: BLE001
                    timeout_url = ""
                try:
                    timeout_title = await page.title()
                except Exception:  # noqa: BLE001
                    timeout_title = ""
                try:
                    await page.screenshot(
                        path=screenshot_path, full_page=True
                    )
                except Exception:  # noqa: BLE001
                    logger.exception("screenshot capture failed (timeout)")
                raise ConfirmationTimeoutError(
                    f"confirmation timeout after {spec.confirm_timeout_ms}ms",
                    url=timeout_url,
                    title=timeout_title,
                    confirmation_html=timeout_html,
                    screenshot_path=screenshot_path,
                ) from exc

            if await detect_captcha(page, spec.captcha_selectors):
                try:
                    captcha_url = page.url
                except Exception:  # noqa: BLE001
                    captcha_url = ""
                try:
                    captcha_png = await page.screenshot(full_page=True)
                except Exception:  # noqa: BLE001
                    captcha_png = b""
                try:
                    with open(screenshot_path, "wb") as fh:
                        fh.write(captcha_png)
                except Exception:  # noqa: BLE001
                    logger.exception(
                        "captcha screenshot disk write failed for %s",
                        screenshot_path,
                    )
                cap_ctx: CaptchaContext = {
                    "url": captcha_url,
                    "screenshot_png": captcha_png,
                }
                if on_captcha is not None:
                    try:
                        await on_captcha(cap_ctx)
                    except Exception:  # noqa: BLE001
                        logger.exception(
                            "on_captcha raised for %s", captcha_url
                        )
                raise CaptchaPauseRequired(cap_ctx)

            confirmation_html = await page.content()
            await page.screenshot(path=screenshot_path, full_page=True)
            submitted_at = datetime.now(timezone.utc)

            await emit(on_progress, "confirmed", screenshot=screenshot_path)

            return SubmitResult(
                confirmation_html=confirmation_html,
                confirmation_screenshot_path=screenshot_path,
                submitted_at=submitted_at,
            )
        finally:
            await browser.close()


__all__ = [
    "AdapterSpec",
    "CaptchaContext",
    "CaptchaPauseRequired",
    "ConfirmationTimeoutError",
    "MissingFieldError",
    "SubmitContext",
    "SubmitResult",
    "drive_form",
    "first_visible",
    "fill_if_present",
    "detect_captcha",
    "emit",
]
