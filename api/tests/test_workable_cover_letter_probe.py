import httpx
import pytest

from app.services.sources.workable import workable_source
from app.services.sources.protocol import CoverLetterRequirement


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_workable_probe_required():
    def handler(request):
        return httpx.Response(200, json={
            "application_form": {
                "form_fields": [
                    {"key": "resume", "label": "Resume", "required": True},
                    {"key": "cover_letter", "label": "Cover Letter", "required": True},
                ],
            },
        })

    async with _client(handler) as http:
        result = await workable_source.probe_cover_letter(
            {}, "https://apply.workable.com/acme/j/ABC123/", http=http,
        )
    assert result is CoverLetterRequirement.REQUIRED


@pytest.mark.asyncio
async def test_workable_probe_not_present():
    def handler(request):
        return httpx.Response(200, json={
            "application_form": {"form_fields": [{"key": "resume", "required": True}]},
        })

    async with _client(handler) as http:
        result = await workable_source.probe_cover_letter(
            {}, "https://apply.workable.com/acme/j/ABC123/", http=http,
        )
    assert result is CoverLetterRequirement.NOT_PRESENT


@pytest.mark.asyncio
async def test_workable_probe_unknown_on_404():
    def handler(request):
        return httpx.Response(404)

    async with _client(handler) as http:
        result = await workable_source.probe_cover_letter(
            {}, "https://apply.workable.com/acme/j/ABC123/", http=http,
        )
    assert result is CoverLetterRequirement.UNKNOWN
