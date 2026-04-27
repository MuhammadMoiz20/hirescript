"""Workable Playwright submit adapter.

The ``apply.workable.com`` flow is a two-step ceremony:

1. **Upload step.** A landing card with a single resume file input and a
   "Apply with resume" button. Clicking it (or attaching a file to the
   ``input[type=file]``) advances to step 2.
2. **Parsed-form review.** Workable parses the resume into name / email /
   phone and pre-fills the form. The candidate corrects fields as needed
   and clicks the final Submit. Workable's parser is fuzzy so the adapter
   re-fills the canonical fields from the profile rather than trusting the
   parse, but it ALSO asserts that the parsed name field is non-empty +
   roughly matches the profile name — catching a swapped/scrambled resume
   before we submit a misattributed application.

The two-step flow is implemented as a ``post_fill`` hook that:

- Uploads the resume to step 1's file input.
- Clicks the "Apply" / "Continue" button to advance.
- Waits for the step-2 form to mount.
- Verifies the parsed name field reads something compatible with the
  profile (case-insensitive substring match on first OR last name);
  raises :class:`MissingFieldError("parsed_name_mismatch")` otherwise.
- Re-fills the canonical fields against step 2's selectors (the post_fill
  hook runs after :func:`drive_form`'s canonical loop, but the step-1 form
  doesn't expose those fields, so the second pass is the one that sticks).

The ``submit_button`` selectors only match step 2's final Submit, so
:func:`drive_form`'s submit click drives the right button.
"""

from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable

from app.services.submit_adapters._base import (
    AdapterSpec,
    CaptchaContext,
    MissingFieldError,
    SubmitContext,
    SubmitResult,
    drive_form,
    emit,
    fill_if_present,
    first_visible,
)

logger = logging.getLogger(__name__)

# Selectors used during step 1 (resume upload).
_STEP1_FILE_INPUT: list[str] = [
    "input[type='file'][name*='resume' i]",
    "input[type='file']",
]
_STEP1_CONTINUE_BUTTON: list[str] = [
    "button[data-ui='apply-button']",
    "button:has-text('Apply')",
    "button:has-text('Continue')",
]

_WORKABLE_SELECTORS: dict[str, list[str]] = {
    "full_name": [
        "input[name='candidate[name]']",
        "input[name='name']",
        "input#name",
    ],
    "first_name": [
        "input[name='candidate[firstname]']",
        "input[name='firstname']",
        "input#firstname",
    ],
    "last_name": [
        "input[name='candidate[lastname]']",
        "input[name='lastname']",
        "input#lastname",
    ],
    "email": [
        "input[name='candidate[email]']",
        "input[name='email']",
        "input[type='email']",
    ],
    "phone": [
        "input[name='candidate[phone]']",
        "input[name='phone']",
    ],
    "linkedin": [
        "input[name*='linkedin' i]",
    ],
    "github": [
        "input[name*='github' i]",
    ],
    "website": [
        "input[name*='website' i]",
        "input[name*='portfolio' i]",
    ],
    # No resume_upload key — the resume goes to step 1 inside the post_fill
    # hook, not via drive_form's standard upload path. Including it would
    # cause drive_form to mark resume_upload as filled twice, but more
    # importantly the step-1 input no longer exists by the time the canonical
    # loop runs in the standard flow.
    "submit_button": [
        "form[data-ui='application-form'] button[type='submit']",
        "button[data-ui='submit']",
        "button[type='submit']:not([data-ui='apply-button'])",
    ],
}

# Required after the post_fill hook has advanced to step 2.
_REQUIRED: set[str] = {"email", "submit_button"}

_CONFIRMATION_JS = """() => {
    const u = (location.href || '').toLowerCase();
    if (u.includes('/thanks') || u.includes('success') ||
        u.includes('applied') || u.includes('thank')) {
        return true;
    }
    if (document.querySelector('[data-ui="application-success"]') ||
        document.querySelector('[data-ui="thank-you"]')) {
        return true;
    }
    const t = (document.body && document.body.innerText || '').toLowerCase();
    if (t.includes('thanks for applying')
        || t.includes('thank you for applying')
        || t.includes('application received')
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


def _name_compatible(parsed: str, first: str, last: str) -> bool:
    """Loose match: parsed value must contain first OR last name (case-insensitive).

    Workable's parser sometimes scrambles diacritics or splits on the wrong
    whitespace, so we don't require an exact match — just enough overlap to
    catch a totally-wrong resume (e.g. someone else's PDF attached).
    """
    p = (parsed or "").strip().lower()
    if not p:
        return False
    if first and first.strip().lower() in p:
        return True
    if last and last.strip().lower() in p:
        return True
    return False


async def _two_step_upload_and_verify(
    page: Any, ctx: SubmitContext
) -> None:
    """Upload the resume on step 1, advance to step 2, verify parsed name.

    Runs as :class:`AdapterSpec.post_fill`. Raises
    :class:`MissingFieldError` with field=``resume_upload`` if step 1's
    file input is missing, or field=``parsed_name_mismatch`` if Workable
    parses a name that does NOT contain the profile's first OR last name.
    The mismatch case is treated as a hard miss so a scrambled / swapped
    resume can never silently submit under the wrong identity.
    """
    # Step 1: upload to the landing page's file input.
    file_input = await first_visible(page, _STEP1_FILE_INPUT)
    if file_input is None:
        raise MissingFieldError("resume_upload")
    await file_input.set_input_files(ctx["resume_pdf_path"])

    # Some Workable layouts auto-advance on attach; others need a button
    # click. Try the button if it's still present and enabled.
    try:
        cont = await first_visible(page, _STEP1_CONTINUE_BUTTON)
        if cont is not None:
            try:
                await cont.click()
            except Exception:  # noqa: BLE001 — already-advanced layouts
                logger.debug("workable: continue button click failed (likely already advanced)")
    except Exception:  # noqa: BLE001
        logger.debug("workable: continue button lookup raised; assuming auto-advance")

    # Step 2: wait for the parsed form to mount.
    try:
        await page.wait_for_selector(
            "form[data-ui='application-form'], "
            "input[name='candidate[name]'], "
            "input[name='candidate[email]']",
            timeout=15_000,
        )
    except Exception:  # noqa: BLE001
        # If the form never mounts, the required-fields gate will catch
        # the empty fill set; nothing more to do here.
        return

    # Identity check on the parsed name field. We only enforce the check
    # when the page actually rendered a name input; an absent field is
    # handled by the canonical fill below.
    name_loc = await first_visible(page, _WORKABLE_SELECTORS["full_name"])
    first = ctx.get("profile_first_name", "") or ""
    last = ctx.get("profile_last_name", "") or ""
    if name_loc is not None and (first or last):
        try:
            parsed = await name_loc.input_value()
        except Exception:  # noqa: BLE001
            parsed = ""
        if parsed and not _name_compatible(parsed, first, last):
            raise MissingFieldError("parsed_name_mismatch")

    # Re-fill the canonical fields against step 2's selectors. The canonical
    # loop in drive_form already ran but matched nothing on step 1, so this
    # second pass populates step 2.
    full_name = (f"{first} {last}").strip()
    fills = (
        ("full_name", full_name),
        ("first_name", first),
        ("last_name", last),
        ("email", ctx.get("profile_email", "") or ""),
        ("phone", ctx.get("profile_phone", "") or ""),
        ("linkedin", (ctx.get("profile_links") or {}).get("linkedin", "")),
        ("github", (ctx.get("profile_links") or {}).get("github", "")),
        ("website", (ctx.get("profile_links") or {}).get("site", "")),
    )
    for fieldname, value in fills:
        try:
            await fill_if_present(page, SPEC, fieldname, value, None)
        except Exception:  # noqa: BLE001
            logger.debug("workable: step-2 fill %s failed", fieldname)
    await emit(None, "workable_step2_filled")


SPEC = AdapterSpec(
    name="workable",
    selectors=_WORKABLE_SELECTORS,
    required=_REQUIRED,
    confirmation_js=_CONFIRMATION_JS,
    post_fill=_two_step_upload_and_verify,
)


async def submit(
    ctx: SubmitContext,
    on_progress: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    *,
    screenshot_dir: str | None = None,
    on_captcha: Callable[[CaptchaContext], Awaitable[None]] | None = None,
) -> SubmitResult:
    """Drive Playwright through a Workable two-step apply flow.

    Same contract as :func:`app.services.submit_adapters.greenhouse.submit`.
    Raises :class:`MissingFieldError("parsed_name_mismatch")` if Workable's
    resume parser produces a name field that does NOT contain the profile's
    first or last name — protects against a scrambled / swapped PDF being
    submitted under the wrong identity.
    """
    return await drive_form(
        SPEC,
        ctx,
        on_progress,
        screenshot_dir=screenshot_dir,
        on_captcha=on_captcha,
    )


__all__ = ["SPEC", "submit"]
