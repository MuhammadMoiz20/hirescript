"""External job-board source adapters (greenhouse, lever, ashby, workable, ...).

The :data:`SOURCES` registry is the only thing other modules import; new
adapters drop in by appending to this dict. See
:mod:`app.services.sources.protocol` for the adapter contract.
"""

from __future__ import annotations

from app.services.sources.ashby import ashby_source
from app.services.sources.greenhouse import greenhouse_source
from app.services.sources.lever import lever_source
from app.services.sources.linkedin import linkedin_source
from app.services.sources.protocol import NormalizedPosting, Source
from app.services.sources.workable import workable_source

__all__ = ["NormalizedPosting", "SOURCES", "Source"]


SOURCES: dict[str, Source] = {
    greenhouse_source.name: greenhouse_source,
    lever_source.name: lever_source,
    ashby_source.name: ashby_source,
    workable_source.name: workable_source,
    linkedin_source.name: linkedin_source,
}
