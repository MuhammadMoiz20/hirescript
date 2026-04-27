"""Submit adapters drive an Application's posting form to completion.

Each adapter encapsulates the per-ATS Playwright choreography (selectors,
upload, confirmation detection) behind a common ``submit(ctx, on_progress)``
contract. The runner stays adapter-agnostic; new ATSes (Lever, Workday, etc.)
land here as additional modules.
"""

from app.services.submit_adapters.greenhouse import (
    CaptchaContext,
    CaptchaPauseRequired,
)

__all__ = ["CaptchaContext", "CaptchaPauseRequired"]
