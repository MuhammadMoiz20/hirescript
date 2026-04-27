"""Submit adapters drive an Application's posting form to completion.

Each adapter encapsulates the per-ATS Playwright choreography (selectors,
upload, confirmation detection) behind a common ``submit(ctx, on_progress)``
contract. The runner stays adapter-agnostic; it dispatches via
:data:`app.services.submit_adapters.registry.ADAPTERS`.
"""

from app.services.submit_adapters.greenhouse import (
    CaptchaContext,
    CaptchaPauseRequired,
    ConfirmationTimeoutError,
    MissingFieldError,
)
from app.services.submit_adapters.protocol import AdapterUnsupported

__all__ = [
    "AdapterUnsupported",
    "CaptchaContext",
    "CaptchaPauseRequired",
    "ConfirmationTimeoutError",
    "MissingFieldError",
]
