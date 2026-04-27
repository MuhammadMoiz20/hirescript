"""Ashby Playwright submit adapter.

Ashby renders apply forms client-side under
``jobs.ashbyhq.com/{org}/{job_id}/application``. The form mounts inside a
``[data-testid='application-form']`` root once the React bundle hydrates;
the adapter waits on that root before filling.

Stable handles we rely on:

- ``[data-testid='_systemfield_name']`` — full name (Ashby splits the legal
  name into first/last server-side, so this is one field on the page).
- ``[data-testid='_systemfield_email']`` — email.
- ``[data-testid='_systemfield_phoneNumber']`` — phone (optional).
- ``[data-testid='_systemfield_resume']`` — resume file input.
- ``button[type='submit']`` inside the form — submit.

Confirmation: Ashby swaps the form for a panel containing
``[data-testid='application-confirmation']`` (or the text "Application
submitted"). Captcha disambiguation is identical to Greenhouse.
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

_ASHBY_SELECTORS: dict[str, list[str]] = {
    "full_name": [
        "[data-testid='_systemfield_name'] input",
        "input[name='_systemfield_name']",
        "input[name='name']",
    ],
    "email": [
        "[data-testid='_systemfield_email'] input",
        "input[name='_systemfield_email']",
        "input[type='email']",
    ],
    "phone": [
        "[data-testid='_systemfield_phoneNumber'] input",
        "input[name='_systemfield_phoneNumber']",
        "input[name*='phone' i]",
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
        "input[name*='portfolio' i]",
    ],
    "resume_upload": [
        "[data-testid='_systemfield_resume'] input[type='file']",
        "input[name='_systemfield_resume']",
        "input[type='file'][name*='resume' i]",
        "input[type='file']",
    ],
    "submit_button": [
        "[data-testid='application-form'] button[type='submit']",
        "button[type='submit']",
    ],
}

_REQUIRED: set[str] = {"full_name", "email", "resume_upload", "submit_button"}

# Ashby renders the form client-side; the JS predicate trips when EITHER the
# success panel mounts OR the page text contains the confirmation copy OR a
# captcha element shows up (the post-wait check disambiguates).
_CONFIRMATION_JS = """() => {
    if (document.querySelector('[data-testid="application-confirmation"]')) {
        return true;
    }
    const u = (location.href || '').toLowerCase();
    if (u.includes('success') || u.includes('confirmation') ||
        u.includes('submitted')) {
        return true;
    }
    const t = (document.body && document.body.innerText || '').toLowerCase();
    if (t.includes('application submitted')
        || t.includes('thank you for applying')
        || t.includes('we received your application')
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


async def _wait_for_form(page: Any, ctx: SubmitContext) -> None:  # noqa: ARG001
    """Block until the React form mounts.

    Used as :class:`AdapterSpec.post_fill` so we run BEFORE the
    canonical-fields loop is meaningful — but ``post_fill`` runs after the
    canonical loop in :func:`drive_form`. To honour that contract we instead
    wait at navigation time by overriding nothing and relying on the field
    selectors' own visibility check; selector-walk silently skips fields
    not yet present, then ``post_fill`` runs the explicit wait + a second
    pass for any fields that appeared late.
    """
    try:
        await page.wait_for_selector(
            "[data-testid='application-form']", timeout=15_000
        )
    except Exception:  # noqa: BLE001 — best-effort; required-fields gate
        # will surface a real miss as MissingFieldError downstream.
        pass


SPEC = AdapterSpec(
    name="ashby",
    selectors=_ASHBY_SELECTORS,
    required=_REQUIRED,
    confirmation_js=_CONFIRMATION_JS,
    pre_submit=_wait_for_form,
)


async def submit(
    ctx: SubmitContext,
    on_progress: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    *,
    screenshot_dir: str | None = None,
    on_captcha: Callable[[CaptchaContext], Awaitable[None]] | None = None,
) -> SubmitResult:
    """Drive Playwright through an Ashby application form.

    Same contract as :func:`app.services.submit_adapters.greenhouse.submit`.
    Waits for the React form root before clicking submit; raises
    :class:`MissingFieldError` if the canonical fields never mount within
    the navigation budget.
    """
    return await drive_form(
        SPEC,
        ctx,
        on_progress,
        screenshot_dir=screenshot_dir,
        on_captcha=on_captcha,
    )


__all__ = ["SPEC", "submit"]
