import httpx
import pytest

from app.services.sources.lever import lever_source
from app.services.sources.protocol import CoverLetterRequirement


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_lever_probe_required_via_application_questions():
    def handler(request):
        return httpx.Response(200, json={
            "applicationQuestions": [
                {"text": "Cover Letter", "required": True, "type": "textarea"},
            ],
        })

    async with _client(handler) as http:
        result = await lever_source.probe_cover_letter(
            {}, "https://jobs.lever.co/acme/abc-123", http=http,
        )
    assert result is CoverLetterRequirement.REQUIRED


@pytest.mark.asyncio
async def test_lever_probe_default_apply_page_is_optional():
    def handler(request):
        return httpx.Response(200, json={"text": "Engineer", "additional": ""})

    async with _client(handler) as http:
        result = await lever_source.probe_cover_letter(
            {}, "https://jobs.lever.co/acme/abc-123", http=http,
        )
    assert result is CoverLetterRequirement.OPTIONAL


@pytest.mark.asyncio
async def test_lever_probe_unknown_on_error():
    def handler(request):
        return httpx.Response(500)

    async with _client(handler) as http:
        result = await lever_source.probe_cover_letter(
            {}, "https://jobs.lever.co/acme/abc-123", http=http,
        )
    assert result is CoverLetterRequirement.UNKNOWN
