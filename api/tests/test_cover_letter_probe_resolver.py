import pytest
from unittest.mock import AsyncMock, MagicMock

from app.services.cover_letter_probe import resolve_cover_letter_requirement
from app.services.sources.protocol import CoverLetterRequirement


@pytest.mark.asyncio
async def test_resolve_uses_cached_meta():
    posting = MagicMock()
    posting.source = "greenhouse"
    posting.apply_url = "https://job-boards.greenhouse.io/loop/jobs/1"
    posting.meta = {"cover_letter": {"requirement": "not_present"}}

    db = MagicMock()
    db.commit = AsyncMock()
    result = await resolve_cover_letter_requirement(db, posting)
    assert result is CoverLetterRequirement.NOT_PRESENT
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_resolve_calls_probe_and_persists(monkeypatch):
    from app.services import cover_letter_probe as mod

    posting = MagicMock()
    posting.source = "greenhouse"
    posting.apply_url = "https://job-boards.greenhouse.io/loop/jobs/1"
    posting.meta = {}

    fake_source = MagicMock()
    fake_source.probe_cover_letter = AsyncMock(
        return_value=CoverLetterRequirement.REQUIRED
    )
    monkeypatch.setattr(mod, "SOURCES", {"greenhouse": fake_source})

    db = MagicMock()
    db.commit = AsyncMock()

    result = await resolve_cover_letter_requirement(db, posting)
    assert result is CoverLetterRequirement.REQUIRED
    assert posting.meta["cover_letter"]["requirement"] == "required"
    fake_source.probe_cover_letter.assert_awaited_once()
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_resolve_returns_unknown_for_unregistered_source(monkeypatch):
    from app.services import cover_letter_probe as mod
    monkeypatch.setattr(mod, "SOURCES", {})
    posting = MagicMock()
    posting.source = "mystery"
    posting.apply_url = "https://x.com/1"
    posting.meta = {}
    db = MagicMock()
    db.commit = AsyncMock()
    result = await resolve_cover_letter_requirement(db, posting)
    assert result is CoverLetterRequirement.UNKNOWN
