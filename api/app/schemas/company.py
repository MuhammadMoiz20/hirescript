"""Pydantic schemas for the companies CRUD routes."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CompanyOut(BaseModel):
    id: int
    slug: str
    display_name: str
    source: str
    enabled: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CompanyCreate(BaseModel):
    """Body for ``POST /companies``.

    The route validates ``source`` against the SOURCES registry (422 on
    unknown source) and runs a sanity-check fetch — a slug that yields
    zero postings is rejected so a typo can't quietly produce zero
    ingest results.
    """

    source: str = Field(min_length=1, max_length=64)
    slug: str = Field(min_length=1, max_length=128)
    display_name: str = Field(min_length=1, max_length=200)

    model_config = ConfigDict(extra="forbid")


class CompanyUpdate(BaseModel):
    """Mutable subset for ``PATCH /companies/{id}``.

    Toggling ``enabled=false`` is the soft-delete pathway used by the
    DELETE route.
    """

    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    enabled: bool | None = None

    model_config = ConfigDict(extra="forbid")
