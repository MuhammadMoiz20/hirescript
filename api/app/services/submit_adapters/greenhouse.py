"""Greenhouse submit adapter — drives a Greenhouse application form via Playwright.

The adapter is deliberately defensive: every selector is a list of fallbacks
tried in order and the adapter logs+skips on miss except for the small set in
:data:`_REQUIRED_FIELDS`, which raise :class:`MissingFieldError` so the runner
can flag the application for human review.

The adapter never truncates content. Confirmation HTML and a screenshot are
captured into a worker-writable directory and returned to the caller, which
persists the artifacts on the :class:`Application` row.

Progress events are emitted through an optional async ``on_progress`` callback.
The phase names (``nav_to_form``, ``filling_field``, ``uploaded_resume``,
``submitting``, ``confirmed``) are stable; the runner re-emits them as
:class:`JobEvent` rows for SSE consumers.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, TypedDict

logger = logging.getLogger(__name__)


class SubmitContext(TypedDict, total=False):
    application_id: int
    posting_apply_url: str
    profile_first_name: str
    profile_last_name: str
    profile_email: str
    profile_phone: str
    profile_links: dict[str, str]
    resume_pdf_path: str
    cover_letter_text: str
    form_payload: dict[str, Any]


class SubmitResult(TypedDict):
    confirmation_html: str
    confirmation_screenshot_path: str
    submitted_at: datetime


class MissingFieldError(Exception):
    """Raised when a mandatory form field is absent from the rendered page."""

    def __init__(self, field: str) -> None:
        super().__init__(f"missing field: {field}")
        self.field = field


# Single source of truth for Greenhouse field locators. Each entry is an
# ordered list of fallbacks; the adapter walks them and uses the first match.
# Keeping this dict centralized means a Greenhouse UI change is a one-place
# fix.
_GREENHOUSE_SELECTORS: dict[str, list[str]] = {
    "first_name": ["input#first_name", "input[name='first_name']"],
    "last_name": ["input#last_name", "input[name='last_name']"],
    "email": ["input#email", "input[type='email']"],
    "phone": ["input#phone", "input[name='phone']"],
    "resume_upload": [
        "input#resume",
        "input[type='file'][name*='resume' i]",
        "input[type='file']",
    ],
    "cover_letter_textarea": [
        "textarea#cover_letter",
        "textarea[name*='cover' i]",
    ],
    "linkedin": [
        "input[name*='linkedin' i]",
        "input[id*='linkedin' i]",
    ],
    "github": [
        "input[name*='github' i]",
        "input[id*='github' i]",
    ],
    "website": [
        "input[name*='website' i]",
        "input[id*='website' i]",
    ],
    "submit_button": [
        "button[type='submit']",
        "input[type='submit']",
    ],
}

# Fields whose absence makes the form unsubmittable. Anything else is best-
# effort — adapter logs+skips so a missing optional cover_letter doesn't
# nuke an otherwise-valid submission.
_REQUIRED_FIELDS: set[str] = {
    "first_name",
    "last_name",
    "email",
    "resume_upload",
    "submit_button",
}

# Default screenshot directory shares the compiled-pdfs volume so artifacts
# survive worker restarts and stay reachable from the api process.
_DEFAULT_SCREENSHOT_DIR = "/app/compiled_pdfs/submit_screenshots"

_NAV_TIMEOUT_MS = 30_000
_CONFIRM_TIMEOUT_MS = 60_000


async def _emit(
    on_progress: Callable[[dict[str, Any]], Awaitable[None]] | None,
    phase: str,
    **data: Any,
) -> None:
    if on_progress is None:
        return
    try:
        await on_progress({"phase": phase, **data})
    except Exception:  # noqa: BLE001 — progress is best-effort
        logger.exception("on_progress callback raised for phase %s", phase)


async def _first_visible(page: Any, selectors: list[str]) -> Any | None:
    """Return the first locator whose first match is attached to the DOM.

    We use ``count() > 0`` instead of ``visibility`` because Greenhouse hides
    file inputs but still lets ``set_input_files`` drive them.
    """
    for sel in selectors:
        loc = page.locator(sel).first
        try:
            if await loc.count() > 0:
                return loc
        except Exception:  # noqa: BLE001
            continue
    return None


async def _fill_if_present(
    page: Any,
    field: str,
    value: str,
    on_progress: Callable[[dict[str, Any]], Awaitable[None]] | None,
) -> bool:
    """Fill ``field`` with ``value`` if a selector matches. Returns True on fill."""
    if not value:
        return False
    selectors = _GREENHOUSE_SELECTORS.get(field, [])
    loc = await _first_visible(page, selectors)
    if loc is None:
        return False
    try:
        await loc.fill(value)
    except Exception:  # noqa: BLE001 — fall back to type for non-fillable
        try:
            await loc.click()
            await loc.type(value)
        except Exception:
            return False
    await _emit(on_progress, "filling_field", field=field)
    return True


async def submit(
    ctx: SubmitContext,
    on_progress: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    *,
    screenshot_dir: str | None = None,
) -> SubmitResult:
    """Drive Playwright through a Greenhouse application form.

    Steps: navigate, fill the canonical fields, upload the resume, fill any
    extra ``form_payload`` keys by label, validate required fields were filled,
    click submit, wait for a confirmation heuristic to fire, capture HTML +
    a screenshot, return the artifacts.
    """
    # Imported lazily so unit tests that don't exercise the adapter (and dev
    # environments without Chromium installed) can still import this module.
    from playwright.async_api import async_playwright

    out_dir = screenshot_dir or _DEFAULT_SCREENSHOT_DIR
    os.makedirs(out_dir, exist_ok=True)

    filled: set[str] = set()

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            context = await browser.new_context()
            page = await context.new_page()

            await _emit(on_progress, "nav_to_form", url=ctx["posting_apply_url"])
            await page.goto(ctx["posting_apply_url"], timeout=_NAV_TIMEOUT_MS)

            # 1. Canonical text fields.
            field_values: dict[str, str] = {
                "first_name": ctx.get("profile_first_name", ""),
                "last_name": ctx.get("profile_last_name", ""),
                "email": ctx.get("profile_email", ""),
                "phone": ctx.get("profile_phone", ""),
                "linkedin": (ctx.get("profile_links") or {}).get("linkedin", ""),
                "github": (ctx.get("profile_links") or {}).get("github", ""),
                "website": (ctx.get("profile_links") or {}).get("site", ""),
            }
            for field, value in field_values.items():
                if await _fill_if_present(page, field, value, on_progress):
                    filled.add(field)

            # 2. Cover letter (optional).
            cover = ctx.get("cover_letter_text", "") or ""
            if cover:
                if await _fill_if_present(
                    page, "cover_letter_textarea", cover, on_progress
                ):
                    filled.add("cover_letter_textarea")

            # 3. Resume upload (required).
            resume_loc = await _first_visible(
                page, _GREENHOUSE_SELECTORS["resume_upload"]
            )
            if resume_loc is not None:
                resume_path = ctx["resume_pdf_path"]
                await resume_loc.set_input_files(resume_path)
                filled.add("resume_upload")
                await _emit(on_progress, "uploaded_resume", path=resume_path)

            # 4. Extra answers via label match — best-effort.
            known_keys = set(_GREENHOUSE_SELECTORS.keys()) | {
                "first_name", "last_name", "email", "phone",
                "linkedin", "github", "website", "cover_letter_textarea",
            }
            extra_payload = ctx.get("form_payload") or {}
            for question, answer in extra_payload.items():
                if not answer or question in known_keys:
                    continue
                try:
                    loc = page.get_by_label(question, exact=False).first
                    if await loc.count() > 0:
                        await loc.fill(str(answer))
                        await _emit(
                            on_progress, "filling_field", field=question
                        )
                except Exception:  # noqa: BLE001 — best-effort label match
                    logger.debug(
                        "no label match for extra field %r", question
                    )

            # 5. Submit button presence is required; click it.
            submit_loc = await _first_visible(
                page, _GREENHOUSE_SELECTORS["submit_button"]
            )
            if submit_loc is not None:
                filled.add("submit_button")

            # Validate required fields BEFORE clicking. If we're missing a
            # required field, raising here means we never touched the form's
            # submit handler — the application stays safely unfiled.
            missing = _REQUIRED_FIELDS - filled
            if missing:
                # Stable order for deterministic error messages.
                first_missing = sorted(missing)[0]
                raise MissingFieldError(first_missing)

            await _emit(on_progress, "submitting")
            await submit_loc.click()

            # 6. Wait for confirmation heuristic: URL contains 'success' or
            # 'applied', OR page text contains a thank-you phrase.
            await page.wait_for_function(
                """() => {
                    const u = (location.href || '').toLowerCase();
                    if (u.includes('success') || u.includes('applied') ||
                        u.includes('submitted') || u.includes('thank')) {
                        return true;
                    }
                    const t = (document.body && document.body.innerText || '')
                        .toLowerCase();
                    return t.includes('thank you')
                        || t.includes('received your application')
                        || t.includes('application received')
                        || t.includes('your application has been');
                }""",
                timeout=_CONFIRM_TIMEOUT_MS,
            )

            confirmation_html = await page.content()
            ts = datetime.now(timezone.utc)
            screenshot_name = (
                f"{ctx['application_id']}_{int(ts.timestamp())}.png"
            )
            screenshot_path = os.path.join(out_dir, screenshot_name)
            await page.screenshot(path=screenshot_path, full_page=True)

            await _emit(on_progress, "confirmed", screenshot=screenshot_path)

            return SubmitResult(
                confirmation_html=confirmation_html,
                confirmation_screenshot_path=screenshot_path,
                submitted_at=ts,
            )
        finally:
            await browser.close()
