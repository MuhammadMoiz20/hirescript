"""Lever Playwright submit adapter.

Lever's apply page (jobs.lever.co/{org}/{job_id}/apply) renders a server-side
HTML form with stable ``name`` attributes (``name``, ``email``, ``phone``,
``urls[LinkedIn]``, ...) and a ``data-qa="btn-submit"`` submit button. The
confirmation pane uses ``data-qa="thanks"`` (or the page text "Thank you for
applying"). Captcha disambiguation is identical to Greenhouse.

This module is a thin :class:`AdapterSpec` config over :func:`drive_form`;
all of the navigate / fill / upload / submit / confirm / captcha-pause
choreography lives in ``_base.py``.
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from app.services.submit_adapters._base import (
    AdapterSpec,
    CaptchaContext,
    SubmitContext,
    SubmitResult,
    drive_form,
)

# Single source of truth for Lever field locators. Each entry is an ordered
# list of fallbacks; the adapter walks them and uses the first match. Lever
# splits first/last name into one ``name`` field, so ``full_name`` is the
# canonical key and ``first_name`` / ``last_name`` are intentionally absent.
_LEVER_SELECTORS: dict[str, list[str]] = {
    "full_name": [
        "input[name='name']",
        "input#name",
    ],
    "email": [
        "input[name='email']",
        "input#email",
        "input[type='email']",
    ],
    "phone": [
        "input[name='phone']",
        "input#phone",
    ],
    "linkedin": [
        "input[name='urls[LinkedIn]']",
        "input[name*='linkedin' i]",
    ],
    "github": [
        "input[name='urls[GitHub]']",
        "input[name*='github' i]",
    ],
    "website": [
        "input[name='urls[Portfolio]']",
        "input[name*='website' i]",
        "input[name*='portfolio' i]",
    ],
    "resume_upload": [
        "input[name='resume']",
        "input[type='file'][name*='resume' i]",
        "input[type='file']",
    ],
    "cover_letter_textarea": [
        "textarea[name='comments']",
        "textarea[name*='cover' i]",
    ],
    "submit_button": [
        "button[data-qa='btn-submit']",
        "button[type='submit']",
        "input[type='submit']",
    ],
}

_REQUIRED: set[str] = {"full_name", "email", "resume_upload", "submit_button"}

# Confirmation predicate — fires on the Lever ``data-qa="thanks"`` element,
# the post-submit URL ``/thanks``, the conventional thank-you copy, or any of
# the captcha selectors (the post-wait check disambiguates).
_CONFIRMATION_JS = """() => {
    const u = (location.href || '').toLowerCase();
    if (u.includes('/thanks') || u.includes('success') ||
        u.includes('applied')) {
        return true;
    }
    if (document.querySelector('[data-qa="thanks"]')) {
        return true;
    }
    const t = (document.body && document.body.innerText || '').toLowerCase();
    if (t.includes('thank you for applying')
        || t.includes('thanks for applying')
        || t.includes('application received')
        || t.includes('your application has been')
        || t.includes('are you human')) {
        return true;
    }
    return !!(
        document.querySelector('iframe[src*="recaptcha"]') ||
        document.querySelector('iframe[src*="hcaptcha"]') ||
        document.querySelector('iframe[title*="captcha"]') ||
        document.querySelector('[data-testid*="captcha"]')
    );
}"""

SPEC = AdapterSpec(
    name="lever",
    selectors=_LEVER_SELECTORS,
    required=_REQUIRED,
    confirmation_js=_CONFIRMATION_JS,
)


async def submit(
    ctx: SubmitContext,
    on_progress: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    *,
    screenshot_dir: str | None = None,
    on_captcha: Callable[[CaptchaContext], Awaitable[None]] | None = None,
) -> SubmitResult:
    """Drive Playwright through a Lever application form.

    Same contract as :func:`app.services.submit_adapters.greenhouse.submit`:
    fills the canonical fields, uploads the resume, clicks submit, waits for
    a Lever confirmation panel, captures HTML + screenshot, returns the
    artifacts. Raises :class:`MissingFieldError` /
    :class:`CaptchaPauseRequired` / :class:`ConfirmationTimeoutError` from
    :mod:`app.services.submit_adapters.greenhouse` so the runner's existing
    handlers apply unchanged.
    """
    return await drive_form(
        SPEC,
        ctx,
        on_progress,
        screenshot_dir=screenshot_dir,
        on_captcha=on_captcha,
    )


__all__ = ["SPEC", "submit"]
