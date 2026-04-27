"""Submit adapter protocol shared by every per-ATS module.

The runner consumes adapters via ``submit(ctx, on_progress=..., **kwargs)``;
each module exposes that callable at module scope. :class:`AdapterUnsupported`
is the structured signal an adapter raises when it recognises the source but
cannot drive this specific posting (e.g. an ATS variant the selectors miss).
The runner treats it as "fall through to the agent submitter" rather than as
a hard failure.
"""

from __future__ import annotations


class AdapterUnsupported(RuntimeError):
    """Raised when a deterministic adapter cannot handle a posting.

    The runner catches this and routes the application through the
    browser-agent fallback (B-mode only). Distinct from a generic
    ``RuntimeError`` so the runner does not swallow real bugs.
    """


__all__ = ["AdapterUnsupported"]
