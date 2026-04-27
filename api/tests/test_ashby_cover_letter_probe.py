import httpx
import pytest

from app.services.sources.ashby import ashby_source
from app.services.sources.protocol import CoverLetterRequirement


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_ashby_probe_required():
    def handler(request):
        assert request.method == "POST"
        return httpx.Response(200, json={
            "data": {
                "jobPosting": {
                    "applicationFormDefinition": {
                        "sections": [
                            {"fields": [
                                {"path": "_systemfield_resume", "isRequired": True},
                                {"path": "_systemfield_cover_letter", "isRequired": True},
                            ]},
                        ],
                    },
                },
            },
        })

    async with _client(handler) as http:
        result = await ashby_source.probe_cover_letter(
            {}, "https://jobs.ashbyhq.com/acme/uuid-here", http=http,
        )
    assert result is CoverLetterRequirement.REQUIRED


@pytest.mark.asyncio
async def test_ashby_probe_optional():
    def handler(request):
        return httpx.Response(200, json={
            "data": {
                "jobPosting": {
                    "applicationFormDefinition": {
                        "sections": [
                            {"fields": [
                                {"path": "_systemfield_cover_letter", "isRequired": False},
                            ]},
                        ],
                    },
                },
            },
        })

    async with _client(handler) as http:
        result = await ashby_source.probe_cover_letter(
            {}, "https://jobs.ashbyhq.com/acme/uuid-here", http=http,
        )
    assert result is CoverLetterRequirement.OPTIONAL


@pytest.mark.asyncio
async def test_ashby_probe_not_present():
    def handler(request):
        return httpx.Response(200, json={
            "data": {
                "jobPosting": {
                    "applicationFormDefinition": {
                        "sections": [
                            {"fields": [{"path": "_systemfield_resume", "isRequired": True}]},
                        ],
                    },
                },
            },
        })

    async with _client(handler) as http:
        result = await ashby_source.probe_cover_letter(
            {}, "https://jobs.ashbyhq.com/acme/uuid-here", http=http,
        )
    assert result is CoverLetterRequirement.NOT_PRESENT


@pytest.mark.asyncio
async def test_ashby_probe_unknown_on_graphql_error():
    def handler(request):
        return httpx.Response(200, json={"errors": [{"message": "not found"}]})

    async with _client(handler) as http:
        result = await ashby_source.probe_cover_letter(
            {}, "https://jobs.ashbyhq.com/acme/uuid-here", http=http,
        )
    assert result is CoverLetterRequirement.UNKNOWN
