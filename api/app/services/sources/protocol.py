"""Source protocol — abstracts an external job-board adapter.

Each ATS family (Greenhouse, Lever, Ashby, Workable, ...) implements
:class:`Source`. The :data:`SOURCES` registry in
``app.services.sources.__init__`` is the only thing other modules import;
they look up adapters by name (``"greenhouse"``, ``"lever"``, ...).

A :class:`NormalizedPosting` is the source-agnostic shape every adapter
returns. The upsert layer in :mod:`app.services.sources.greenhouse`
(``upsert_postings``) consumes it directly — same shape regardless of
source — so adding a new adapter is "implement the protocol, register it,
done".
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal, Protocol, TypedDict, runtime_checkable

import httpx


TosRisk = Literal["clean", "high"]


class CoverLetterRequirement(str, Enum):
    """Whether the application form expects a cover letter.

    UNKNOWN is the safe default — the prepare flow generates one anyway,
    because shipping with a CL when the form has none costs nothing, but
    skipping when it's required blocks submit.
    """

    REQUIRED = "required"
    OPTIONAL = "optional"
    NOT_PRESENT = "not_present"
    UNKNOWN = "unknown"

    def should_generate(self) -> bool:
        return self is not CoverLetterRequirement.NOT_PRESENT


class NormalizedPosting(TypedDict):
    """Source-agnostic posting payload.

    ``description_html`` is allowed to be ``None`` for sources that only
    return plaintext; ``description_text`` must always be present so the
    classifier and tailor have something to read.
    """

    source_job_id: str
    title: str
    location: str | None
    apply_url: str
    description_html: str | None
    description_text: str
    meta: dict[str, Any]


@runtime_checkable
class Source(Protocol):
    """Adapter interface for an external job board.

    ``name`` is the canonical source string persisted in
    ``job_postings.source`` and ``companies.source``. Must match the key
    used in :data:`SOURCES`.
    """

    name: str

    # Optional ToS-risk tag — sources that scrape sites whose ToS forbids
    # automated access mark themselves "high" so the UI can surface a badge.
    # Defaults to "clean" via class-level attribute on each implementation.
    tos_risk: TosRisk

    async def fetch_company_postings(
        self, slug: str, *, http: httpx.AsyncClient
    ) -> list[NormalizedPosting]:
        """Fetch every posting for ``slug``. ``[]`` on 404."""

    def matches_url(self, url: str) -> bool:
        """True if a pasted URL belongs to this source."""

    def slug_from_url(self, url: str) -> str:
        """Extract the company slug from a posting URL.

        Raises ``ValueError`` when the URL is not a posting URL for this
        source.
        """

    async def fetch_one_url(
        self, url: str, *, http: httpx.AsyncClient
    ) -> NormalizedPosting:
        """Fetch a single posting by URL.

        Raises ``ValueError`` when ``url`` does not match this source.
        """

    async def probe_cover_letter(
        self, posting_meta: dict[str, Any], apply_url: str, *, http: httpx.AsyncClient
    ) -> CoverLetterRequirement:
        """Inspect the application form for this posting.

        Implementations should never raise — return ``UNKNOWN`` on any
        network/parse failure so prepare always proceeds.
        """
