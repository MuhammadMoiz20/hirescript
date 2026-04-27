import httpx
import pytest

from app.services.sources.greenhouse import greenhouse_source
from app.services.sources.protocol import CoverLetterRequirement


def _client(handler):
    transport = httpx.MockTransport(handler)
    return httpx.AsyncClient(transport=transport)


@pytest.mark.asyncio
async def test_greenhouse_probe_required():
    def handler(request):
        assert "questions=true" in str(request.url)
        return httpx.Response(200, json={
            "questions": [
                {"label": "Resume/CV", "required": True, "fields": [{"type": "input_file", "name": "resume"}]},
                {"label": "Cover Letter", "required": True, "fields": [{"type": "input_file", "name": "cover_letter"}]},
            ]
        })

    async with _client(handler) as http:
        result = await greenhouse_source.probe_cover_letter(
            {"slug": "loop"}, "https://job-boards.greenhouse.io/loop/jobs/123", http=http,
        )
    assert result is CoverLetterRequirement.REQUIRED


@pytest.mark.asyncio
async def test_greenhouse_probe_optional():
    def handler(request):
        return httpx.Response(200, json={
            "questions": [
                {"label": "Cover Letter", "required": False, "fields": [{"type": "input_file"}]},
            ]
        })

    async with _client(handler) as http:
        result = await greenhouse_source.probe_cover_letter(
            {"slug": "loop"}, "https://job-boards.greenhouse.io/loop/jobs/123", http=http,
        )
    assert result is CoverLetterRequirement.OPTIONAL


@pytest.mark.asyncio
async def test_greenhouse_probe_not_present():
    def handler(request):
        return httpx.Response(200, json={
            "questions": [
                {"label": "Resume", "required": True, "fields": [{"type": "input_file"}]},
                {"label": "LinkedIn", "required": False, "fields": [{"type": "input_text"}]},
            ]
        })

    async with _client(handler) as http:
        result = await greenhouse_source.probe_cover_letter(
            {"slug": "loop"}, "https://job-boards.greenhouse.io/loop/jobs/123", http=http,
        )
    assert result is CoverLetterRequirement.NOT_PRESENT


@pytest.mark.asyncio
async def test_greenhouse_probe_returns_unknown_on_404():
    def handler(request):
        return httpx.Response(404, json={"error": "not found"})

    async with _client(handler) as http:
        result = await greenhouse_source.probe_cover_letter(
            {"slug": "loop"}, "https://job-boards.greenhouse.io/loop/jobs/999", http=http,
        )
    assert result is CoverLetterRequirement.UNKNOWN


@pytest.mark.asyncio
async def test_greenhouse_probe_returns_unknown_when_url_unparseable():
    async with httpx.AsyncClient() as http:
        result = await greenhouse_source.probe_cover_letter(
            {}, "https://example.com/not-a-greenhouse-url", http=http,
        )
    assert result is CoverLetterRequirement.UNKNOWN
