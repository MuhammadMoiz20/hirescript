"""Submit adapter registry.

Maps ``posting.source`` to the adapter module that drives that ATS. The
runner does ``ADAPTERS.get(posting.source)`` and, on miss (or on
:class:`AdapterUnsupported`), falls back to the browser-agent submitter.

Each entry is a module exposing ``submit(ctx, on_progress, ...)``. Keeping the
registry in its own module avoids an import cycle with ``__init__.py`` once
the agent submitter (which lives in this package) needs to import the
deterministic adapters.
"""

from __future__ import annotations

from types import ModuleType

from app.services.submit_adapters import greenhouse, lever

# Keyed by the same string used in ``JobPosting.source`` and the
# ``app.services.sources.SOURCES`` registry, so the inbox + submit paths
# share a single vocabulary. Tasks 2 + 3 register ashby + workable here.
ADAPTERS: dict[str, ModuleType] = {
    "greenhouse": greenhouse,
    "lever": lever,
}


__all__ = ["ADAPTERS"]
