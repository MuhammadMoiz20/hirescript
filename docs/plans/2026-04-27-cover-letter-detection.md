# Cover Letter Requirement Detection — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect per-posting whether a cover letter is required and skip generation when the form has no cover letter field. Works across Greenhouse, Lever, Workable, Ashby, LinkedIn, Indeed, Wellfound.

**Architecture:** Each `Source` adapter gains a `probe_cover_letter(posting, *, http)` method returning a `CoverLetterRequirement` enum. Probes run **lazily during prepare** (not at ingest), result cached in `job_postings.meta["cover_letter"]` so re-prepares are free. The prepare runner reads this and only invokes `generate_cover_letter` when the requirement is `REQUIRED`, `OPTIONAL`, or `UNKNOWN` (defaults to generating — safer). The UI surfaces the state as a small badge on the QueueCard.

**Tech Stack:** Python 3.12, FastAPI, async SQLAlchemy 2.x, httpx, pytest, React 18 + TypeScript. Probes use the same per-source public APIs already used by `fetch_company_postings` where possible (Greenhouse/Lever/Workable). Ashby uses its undocumented-but-stable GraphQL endpoint. Scraper sources (LinkedIn/Indeed/Wellfound) return `UNKNOWN`.

---

## Task 1: Define `CoverLetterRequirement` enum and probe protocol

**Files:**
- Modify: `api/app/services/sources/protocol.py`
- Test: `api/tests/test_sources_protocol.py`

**Step 1: Write the failing test**

Append to `api/tests/test_sources_protocol.py`:

```python
from app.services.sources.protocol import CoverLetterRequirement


def test_cover_letter_requirement_values():
    assert CoverLetterRequirement.REQUIRED.value == "required"
    assert CoverLetterRequirement.OPTIONAL.value == "optional"
    assert CoverLetterRequirement.NOT_PRESENT.value == "not_present"
    assert CoverLetterRequirement.UNKNOWN.value == "unknown"


def test_cover_letter_requirement_should_generate():
    assert CoverLetterRequirement.REQUIRED.should_generate()
    assert CoverLetterRequirement.OPTIONAL.should_generate()
    assert CoverLetterRequirement.UNKNOWN.should_generate()
    assert not CoverLetterRequirement.NOT_PRESENT.should_generate()
```

**Step 2: Run test to verify it fails**

Run: `docker compose run --rm api pytest tests/test_sources_protocol.py -v`
Expected: FAIL — `ImportError: cannot import name 'CoverLetterRequirement'`

**Step 3: Implement the enum**

Add to top of `api/app/services/sources/protocol.py` (after the existing imports):

```python
from enum import Enum


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
```

Then extend the `Source` Protocol class with a probe method (append after `fetch_one_url`):

```python
    async def probe_cover_letter(
        self, posting_meta: dict[str, Any], apply_url: str, *, http: httpx.AsyncClient
    ) -> CoverLetterRequirement:
        """Inspect the application form for this posting.

        Implementations should never raise — return ``UNKNOWN`` on any
        network/parse failure so prepare always proceeds.
        """
```

Update `__all__` in `api/app/services/sources/__init__.py` to export `CoverLetterRequirement`:

```python
from app.services.sources.protocol import (
    CoverLetterRequirement,
    NormalizedPosting,
    Source,
)

__all__ = ["CoverLetterRequirement", "NormalizedPosting", "SOURCES", "Source"]
```

**Step 4: Run test to verify it passes**

Run: `docker compose run --rm api pytest tests/test_sources_protocol.py -v`
Expected: PASS (all tests including new ones)

**Step 5: Commit**

```bash
git add api/app/services/sources/protocol.py api/app/services/sources/__init__.py api/tests/test_sources_protocol.py
git commit -m "feat(api): CoverLetterRequirement enum + Source.probe_cover_letter contract"
```

---

## Task 2: Greenhouse probe (public API)

**Files:**
- Modify: `api/app/services/sources/greenhouse.py`
- Test: `api/tests/test_greenhouse_cover_letter_probe.py` (new)

**Background:** Greenhouse exposes job questions at
`GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs/{job_id}?questions=true`.
Response includes `questions: [{label, required, fields:[{type,name,...}]}]`. We look for a question whose `label` contains "cover letter" (case-insensitive).

**Step 1: Write the failing test**

Create `api/tests/test_greenhouse_cover_letter_probe.py`:

```python
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
```

**Step 2: Run test to verify it fails**

Run: `docker compose run --rm api pytest tests/test_greenhouse_cover_letter_probe.py -v`
Expected: FAIL — `AttributeError: 'GreenhouseSource' object has no attribute 'probe_cover_letter'`

**Step 3: Implement the probe**

Add to `api/app/services/sources/greenhouse.py` (inside `GreenhouseSource` class):

```python
    async def probe_cover_letter(
        self,
        posting_meta: dict[str, Any],
        apply_url: str,
        *,
        http: httpx.AsyncClient,
    ) -> CoverLetterRequirement:
        # Extract slug + job id. Prefer meta if upserter stored it, else parse URL.
        slug = posting_meta.get("slug") or self._slug_from_url_safe(apply_url)
        job_id = self._job_id_from_url(apply_url)
        if not slug or not job_id:
            return CoverLetterRequirement.UNKNOWN
        url = f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs/{job_id}"
        try:
            resp = await http.get(url, params={"questions": "true"}, timeout=10.0)
            if resp.status_code != 200:
                return CoverLetterRequirement.UNKNOWN
            data = resp.json()
        except (httpx.HTTPError, ValueError):
            return CoverLetterRequirement.UNKNOWN
        return _classify_questions(data.get("questions") or [])

    def _slug_from_url_safe(self, url: str) -> str | None:
        try:
            return self.slug_from_url(url)
        except ValueError:
            return None

    @staticmethod
    def _job_id_from_url(url: str) -> str | None:
        # job-boards.greenhouse.io/{slug}/jobs/{id}
        # boards.greenhouse.io/{slug}/jobs/{id}
        import re
        m = re.search(r"/jobs/(\d+)", url)
        return m.group(1) if m else None
```

Add a module-level helper at the bottom of the file:

```python
def _classify_questions(questions: list[dict]) -> CoverLetterRequirement:
    for q in questions:
        label = (q.get("label") or "").lower()
        if "cover letter" not in label:
            continue
        return (
            CoverLetterRequirement.REQUIRED
            if q.get("required")
            else CoverLetterRequirement.OPTIONAL
        )
    return CoverLetterRequirement.NOT_PRESENT
```

Add the import at the top of greenhouse.py:

```python
from app.services.sources.protocol import CoverLetterRequirement, NormalizedPosting, Source
```

**Step 4: Run test to verify it passes**

Run: `docker compose run --rm api pytest tests/test_greenhouse_cover_letter_probe.py -v`
Expected: PASS — all 5 tests

**Step 5: Commit**

```bash
git add api/app/services/sources/greenhouse.py api/tests/test_greenhouse_cover_letter_probe.py
git commit -m "feat(api): greenhouse cover-letter probe via questions=true"
```

---

## Task 3: Lever probe (public API)

**Files:**
- Modify: `api/app/services/sources/lever.py`
- Test: `api/tests/test_lever_cover_letter_probe.py` (new)

**Background:** Lever's posting endpoint (`https://api.lever.co/v0/postings/{slug}/{id}`) returns `additional` HTML and `applicationQuestions` (when present, mainly for jobs gated behind a custom form). For the standard apply page, Lever shows resume + cover letter file inputs by default; the form schema isn't always exposed. Strategy: hit the JSON endpoint with `?mode=json`. If `applicationQuestions` exists, scan labels. If not, treat as `OPTIONAL` (Lever's default apply page accepts a cover letter PDF/textarea).

**Step 1: Write the failing test**

Create `api/tests/test_lever_cover_letter_probe.py`:

```python
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
    # No applicationQuestions → Lever's default form accepts a CL.
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
```

**Step 2: Run test to verify it fails**

Run: `docker compose run --rm api pytest tests/test_lever_cover_letter_probe.py -v`
Expected: FAIL — no `probe_cover_letter` on `lever_source`.

**Step 3: Implement the probe**

Add to `LeverSource` class in `api/app/services/sources/lever.py`:

```python
    async def probe_cover_letter(
        self,
        posting_meta: dict[str, Any],
        apply_url: str,
        *,
        http: httpx.AsyncClient,
    ) -> CoverLetterRequirement:
        slug, posting_id = self._parse_url(apply_url)
        if not slug or not posting_id:
            return CoverLetterRequirement.UNKNOWN
        url = f"https://api.lever.co/v0/postings/{slug}/{posting_id}"
        try:
            resp = await http.get(url, params={"mode": "json"}, timeout=10.0)
            if resp.status_code != 200:
                return CoverLetterRequirement.UNKNOWN
            data = resp.json()
        except (httpx.HTTPError, ValueError):
            return CoverLetterRequirement.UNKNOWN
        questions = data.get("applicationQuestions") or []
        if questions:
            for q in questions:
                label = (q.get("text") or q.get("label") or "").lower()
                if "cover letter" in label:
                    return (
                        CoverLetterRequirement.REQUIRED
                        if q.get("required")
                        else CoverLetterRequirement.OPTIONAL
                    )
            return CoverLetterRequirement.NOT_PRESENT
        # Default Lever apply page accepts a CL textarea/file but doesn't
        # require one.
        return CoverLetterRequirement.OPTIONAL

    @staticmethod
    def _parse_url(url: str) -> tuple[str | None, str | None]:
        import re
        m = re.match(r"https?://jobs\.lever\.co/([^/]+)/([^/?#]+)", url)
        return (m.group(1), m.group(2)) if m else (None, None)
```

Add import at top: `from app.services.sources.protocol import CoverLetterRequirement, ...` (extend existing import).

**Step 4: Run test to verify it passes**

Run: `docker compose run --rm api pytest tests/test_lever_cover_letter_probe.py -v`
Expected: PASS — 3 tests.

**Step 5: Commit**

```bash
git add api/app/services/sources/lever.py api/tests/test_lever_cover_letter_probe.py
git commit -m "feat(api): lever cover-letter probe via mode=json"
```

---

## Task 4: Workable probe (public API)

**Files:**
- Modify: `api/app/services/sources/workable.py`
- Test: `api/tests/test_workable_cover_letter_probe.py` (new)

**Background:** Workable's public endpoint
`GET https://apply.workable.com/api/v3/accounts/{slug}/jobs/{shortcode}` returns a JSON object with `application_form.form_fields[]`. Each form field has `key`, `label`, `required`. The cover-letter field's `key` is typically `"cover_letter"` or `"coverletter"`.

**Step 1: Write the failing test**

Create `api/tests/test_workable_cover_letter_probe.py`:

```python
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
```

**Step 2: Run test to verify it fails**

Run: `docker compose run --rm api pytest tests/test_workable_cover_letter_probe.py -v`
Expected: FAIL.

**Step 3: Implement the probe**

Add to `WorkableSource` class:

```python
    async def probe_cover_letter(
        self,
        posting_meta: dict[str, Any],
        apply_url: str,
        *,
        http: httpx.AsyncClient,
    ) -> CoverLetterRequirement:
        slug, shortcode = self._parse_url(apply_url)
        if not slug or not shortcode:
            return CoverLetterRequirement.UNKNOWN
        url = f"https://apply.workable.com/api/v3/accounts/{slug}/jobs/{shortcode}"
        try:
            resp = await http.get(url, timeout=10.0)
            if resp.status_code != 200:
                return CoverLetterRequirement.UNKNOWN
            data = resp.json()
        except (httpx.HTTPError, ValueError):
            return CoverLetterRequirement.UNKNOWN
        form = (data.get("application_form") or {}).get("form_fields") or []
        for f in form:
            key = (f.get("key") or "").lower().replace("-", "_")
            label = (f.get("label") or "").lower()
            if "cover_letter" in key or "coverletter" in key or "cover letter" in label:
                return (
                    CoverLetterRequirement.REQUIRED
                    if f.get("required")
                    else CoverLetterRequirement.OPTIONAL
                )
        return CoverLetterRequirement.NOT_PRESENT

    @staticmethod
    def _parse_url(url: str) -> tuple[str | None, str | None]:
        import re
        m = re.match(r"https?://apply\.workable\.com/([^/]+)/j/([^/?#]+)", url)
        return (m.group(1), m.group(2)) if m else (None, None)
```

Add `CoverLetterRequirement` to existing protocol import.

**Step 4: Run test to verify it passes**

Run: `docker compose run --rm api pytest tests/test_workable_cover_letter_probe.py -v`
Expected: PASS — 3 tests.

**Step 5: Commit**

```bash
git add api/app/services/sources/workable.py api/tests/test_workable_cover_letter_probe.py
git commit -m "feat(api): workable cover-letter probe via apply.workable.com api"
```

---

## Task 5: Ashby probe (GraphQL)

**Files:**
- Modify: `api/app/services/sources/ashby.py`
- Test: `api/tests/test_ashby_cover_letter_probe.py` (new)

**Background:** Ashby's public job board uses a GraphQL endpoint:
`POST https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting`
with body
```json
{
  "operationName": "ApiJobPosting",
  "variables": {"organizationHostedJobsPageName": "<slug>", "jobPostingId": "<uuid>"},
  "query": "<...>"
}
```
The response includes `jobPosting.applicationFormDefinition.sections[].fields[]` where each field has `path` (e.g., `_systemfield_resume`, `_systemfield_cover_letter`) and `isRequired`.

We only need a minimal query asking for the form fields.

**Step 1: Write the failing test**

Create `api/tests/test_ashby_cover_letter_probe.py`:

```python
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
```

**Step 2: Run test to verify it fails**

Run: `docker compose run --rm api pytest tests/test_ashby_cover_letter_probe.py -v`
Expected: FAIL.

**Step 3: Implement the probe**

Add to `AshbySource` class in `api/app/services/sources/ashby.py`:

```python
    _GQL_QUERY = """
        query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
          jobPosting(
            organizationHostedJobsPageName: $organizationHostedJobsPageName
            jobPostingId: $jobPostingId
          ) {
            applicationFormDefinition {
              sections { fields { path isRequired } }
            }
          }
        }
    """

    async def probe_cover_letter(
        self,
        posting_meta: dict[str, Any],
        apply_url: str,
        *,
        http: httpx.AsyncClient,
    ) -> CoverLetterRequirement:
        slug, posting_id = self._parse_url(apply_url)
        if not slug or not posting_id:
            return CoverLetterRequirement.UNKNOWN
        try:
            resp = await http.post(
                "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting",
                json={
                    "operationName": "ApiJobPosting",
                    "variables": {
                        "organizationHostedJobsPageName": slug,
                        "jobPostingId": posting_id,
                    },
                    "query": self._GQL_QUERY,
                },
                timeout=10.0,
            )
            if resp.status_code != 200:
                return CoverLetterRequirement.UNKNOWN
            payload = resp.json()
        except (httpx.HTTPError, ValueError):
            return CoverLetterRequirement.UNKNOWN
        if payload.get("errors"):
            return CoverLetterRequirement.UNKNOWN
        sections = (
            (((payload.get("data") or {}).get("jobPosting") or {})
             .get("applicationFormDefinition") or {})
            .get("sections") or []
        )
        for section in sections:
            for field in section.get("fields") or []:
                path = (field.get("path") or "").lower()
                if "cover_letter" in path or "coverletter" in path:
                    return (
                        CoverLetterRequirement.REQUIRED
                        if field.get("isRequired")
                        else CoverLetterRequirement.OPTIONAL
                    )
        return CoverLetterRequirement.NOT_PRESENT

    @staticmethod
    def _parse_url(url: str) -> tuple[str | None, str | None]:
        import re
        m = re.match(r"https?://jobs\.ashbyhq\.com/([^/]+)/([^/?#]+)", url)
        return (m.group(1), m.group(2)) if m else (None, None)
```

Add `CoverLetterRequirement` to protocol import.

**Step 4: Run test to verify it passes**

Run: `docker compose run --rm api pytest tests/test_ashby_cover_letter_probe.py -v`
Expected: PASS — 4 tests.

**Step 5: Commit**

```bash
git add api/app/services/sources/ashby.py api/tests/test_ashby_cover_letter_probe.py
git commit -m "feat(api): ashby cover-letter probe via non-user graphql"
```

---

## Task 6: Default `UNKNOWN` probe for scraper sources (LinkedIn / Indeed / Wellfound)

**Files:**
- Modify: `api/app/services/sources/linkedin.py`
- Modify: `api/app/services/sources/indeed.py`
- Modify: `api/app/services/sources/wellfound.py`
- Test: `api/tests/test_scraper_sources_probe_unknown.py` (new)

**Background:** These three scrape live HTML and apply via Playwright; there's no cheap probe. Return `UNKNOWN` (which still triggers generation — the default-safe path).

**Step 1: Write the failing test**

Create `api/tests/test_scraper_sources_probe_unknown.py`:

```python
import httpx
import pytest

from app.services.sources.linkedin import linkedin_source
from app.services.sources.indeed import indeed_source
from app.services.sources.wellfound import wellfound_source
from app.services.sources.protocol import CoverLetterRequirement


@pytest.mark.parametrize("source,url", [
    (linkedin_source, "https://www.linkedin.com/jobs/view/12345"),
    (indeed_source, "https://www.indeed.com/viewjob?jk=abc"),
    (wellfound_source, "https://wellfound.com/jobs/12345"),
])
@pytest.mark.asyncio
async def test_scraper_sources_return_unknown(source, url):
    async with httpx.AsyncClient() as http:
        result = await source.probe_cover_letter({}, url, http=http)
    assert result is CoverLetterRequirement.UNKNOWN
```

**Step 2: Run test to verify it fails**

Run: `docker compose run --rm api pytest tests/test_scraper_sources_probe_unknown.py -v`
Expected: FAIL — methods don't exist yet.

**Step 3: Implement**

Add this method to each of `LinkedInSource`, `IndeedSource`, `WellfoundSource`:

```python
    async def probe_cover_letter(
        self,
        posting_meta: dict[str, Any],
        apply_url: str,
        *,
        http: httpx.AsyncClient,
    ) -> CoverLetterRequirement:
        # Scraper sources don't expose a cheap form schema; return UNKNOWN
        # so the prepare flow defaults to generating a cover letter.
        return CoverLetterRequirement.UNKNOWN
```

Add `CoverLetterRequirement` to each file's protocol import.

**Step 4: Run test to verify it passes**

Run: `docker compose run --rm api pytest tests/test_scraper_sources_probe_unknown.py -v`
Expected: PASS — 3 parametrized cases.

**Step 5: Commit**

```bash
git add api/app/services/sources/linkedin.py api/app/services/sources/indeed.py api/app/services/sources/wellfound.py api/tests/test_scraper_sources_probe_unknown.py
git commit -m "feat(api): UNKNOWN cover-letter probe for scraper sources"
```

---

## Task 7: `cover_letter_probe.resolve()` orchestrator with meta caching

**Files:**
- Create: `api/app/services/cover_letter_probe.py`
- Test: `api/tests/test_cover_letter_probe_resolver.py` (new)

**Background:** Centralizes "look up cached result in posting.meta, otherwise call source probe and persist". Saves every other module from re-implementing the cache logic.

**Step 1: Write the failing test**

Create `api/tests/test_cover_letter_probe_resolver.py`:

```python
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.services.cover_letter_probe import resolve_cover_letter_requirement
from app.services.sources.protocol import CoverLetterRequirement


@pytest.mark.asyncio
async def test_resolve_uses_cached_meta(monkeypatch):
    posting = MagicMock()
    posting.source = "greenhouse"
    posting.apply_url = "https://job-boards.greenhouse.io/loop/jobs/1"
    posting.meta = {"cover_letter": {"requirement": "not_present"}}

    db = MagicMock()  # should NOT be touched
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
```

**Step 2: Run test to verify it fails**

Run: `docker compose run --rm api pytest tests/test_cover_letter_probe_resolver.py -v`
Expected: FAIL — module doesn't exist.

**Step 3: Implement**

Create `api/app/services/cover_letter_probe.py`:

```python
"""Resolve a posting's cover-letter requirement, caching the result in meta.

The first prepare for a posting calls the source-specific probe; subsequent
prepares (e.g., user retried after edits) read from
``job_postings.meta["cover_letter"]`` for free.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.job_posting import JobPosting
from app.services.sources import SOURCES
from app.services.sources.protocol import CoverLetterRequirement

log = logging.getLogger(__name__)


async def resolve_cover_letter_requirement(
    db: AsyncSession, posting: JobPosting
) -> CoverLetterRequirement:
    """Return the cached requirement, probing if absent. Never raises."""
    cached = (posting.meta or {}).get("cover_letter") or {}
    cached_value = cached.get("requirement")
    if cached_value:
        try:
            return CoverLetterRequirement(cached_value)
        except ValueError:
            pass  # corrupt cache → re-probe

    source = SOURCES.get(posting.source)
    if source is None:
        return CoverLetterRequirement.UNKNOWN

    async with httpx.AsyncClient() as http:
        try:
            requirement = await source.probe_cover_letter(
                dict(posting.meta or {}), posting.apply_url, http=http,
            )
        except Exception:  # defensive: probes promise not to raise, but be safe
            log.exception("probe_cover_letter raised for posting %s", posting.id)
            requirement = CoverLetterRequirement.UNKNOWN

    posting.meta = {
        **(posting.meta or {}),
        "cover_letter": {
            "requirement": requirement.value,
            "probed_at": datetime.now(timezone.utc).isoformat(),
        },
    }
    flag_modified(posting, "meta")
    await db.commit()
    return requirement
```

**Step 4: Run test to verify it passes**

Run: `docker compose run --rm api pytest tests/test_cover_letter_probe_resolver.py -v`
Expected: PASS — 3 tests.

**Step 5: Commit**

```bash
git add api/app/services/cover_letter_probe.py api/tests/test_cover_letter_probe_resolver.py
git commit -m "feat(api): cover_letter_probe resolver with meta caching"
```

---

## Task 8: Wire conditional generation into `run_prepare_application_job`

**Files:**
- Modify: `api/app/services/jobs_runner.py:843-856` (the cover-letter step)
- Test: `api/tests/test_prepare_skips_cover_letter_when_not_present.py` (new)

**Background:** This is the payoff — actually skip generation when `NOT_PRESENT`.

**Step 1: Write the failing test**

Create `api/tests/test_prepare_skips_cover_letter_when_not_present.py`:

```python
"""Integration-style test: posting whose probe says NOT_PRESENT skips CL gen.

Uses the real run_prepare_application_job with the cover_letter generator
and the source probe both mocked.
"""
import uuid
from unittest.mock import AsyncMock, patch

import pytest

from app.services.sources.protocol import CoverLetterRequirement


@pytest.mark.asyncio
async def test_prepare_skips_cl_when_probe_says_not_present(
    db_session_factory, seeded_user_with_master_resume, seeded_posting,
):
    job_id = uuid.uuid4()
    # Pre-cache the meta so resolver doesn't hit network.
    async with db_session_factory() as s:
        seeded_posting.meta = {"cover_letter": {"requirement": "not_present"}}
        s.add(seeded_posting)
        await s.commit()

    with patch(
        "app.services.jobs_runner.generate_cover_letter",
        new=AsyncMock(return_value="SHOULD NOT BE CALLED"),
    ) as cl_mock, patch(
        "app.services.jobs_runner.tailor_for_application",
        new=AsyncMock(return_value={
            "variant_id": 1, "page_count": 1, "iterations": 1,
            "enforced": True, "kb_chunks_used": 0,
        }),
    ):
        from app.services.jobs_runner import run_prepare_application_job
        # ... seed a queued job row, then call:
        # await run_prepare_application_job(db_session_factory, job_id)
        # (Use the existing prepare-job test scaffolding pattern from
        # tests/test_jobs_runner_prepare.py if it exists; otherwise build
        # the minimal Job row inline.)

    cl_mock.assert_not_awaited()
    # Application should still exist with cover_letter_text = ""/None.
    async with db_session_factory() as s:
        from sqlalchemy import select
        from app.models.application import Application
        app_row = (await s.execute(select(Application))).scalar_one()
        assert (app_row.cover_letter_text or "") == ""


@pytest.mark.asyncio
async def test_prepare_generates_cl_when_probe_says_required(
    db_session_factory, seeded_user_with_master_resume, seeded_posting,
):
    async with db_session_factory() as s:
        seeded_posting.meta = {"cover_letter": {"requirement": "required"}}
        s.add(seeded_posting)
        await s.commit()

    with patch(
        "app.services.jobs_runner.generate_cover_letter",
        new=AsyncMock(return_value="dear hiring manager"),
    ) as cl_mock, patch(
        "app.services.jobs_runner.tailor_for_application",
        new=AsyncMock(return_value={
            "variant_id": 1, "page_count": 1, "iterations": 1,
            "enforced": True, "kb_chunks_used": 0,
        }),
    ):
        from app.services.jobs_runner import run_prepare_application_job
        # await run_prepare_application_job(...)

    cl_mock.assert_awaited_once()
```

> **Note:** The fixtures `db_session_factory`, `seeded_user_with_master_resume`, `seeded_posting` may need to be created or adapted from existing fixtures in `api/tests/conftest.py`. Inspect existing prepare-related tests (`grep -l "run_prepare_application_job" api/tests/`) and reuse their setup pattern. If no such fixtures exist, the simpler path is to write a unit test for just the new branch using `monkeypatch` on `resolve_cover_letter_requirement` and skip the full pipeline.

**Step 2: Run test to verify it fails**

Run: `docker compose run --rm api pytest tests/test_prepare_skips_cover_letter_when_not_present.py -v`
Expected: FAIL — current code always calls `generate_cover_letter`.

**Step 3: Modify the runner**

In `api/app/services/jobs_runner.py`, find the cover-letter block (around line 845-856):

```python
        # 3. Cover letter (read-only — no commit needed).
        async with sf() as s:
            cover_letter_text = await generate_cover_letter(
                s, user_id=1, posting_id=posting_id
            )
        await emit_event(
            sf,
            job_id,
            phase="cover_letter_generated",
            message=None,
            data={"length": len(cover_letter_text)},
        )
```

Replace with:

```python
        # 3. Cover letter — only generated when the posting form has a CL field.
        from app.services.cover_letter_probe import (
            resolve_cover_letter_requirement,
        )
        async with sf() as s:
            posting_row = await s.get(JobPosting, posting_id)
            cl_requirement = await resolve_cover_letter_requirement(s, posting_row)

        if cl_requirement.should_generate():
            async with sf() as s:
                cover_letter_text = await generate_cover_letter(
                    s, user_id=1, posting_id=posting_id
                )
            await emit_event(
                sf, job_id,
                phase="cover_letter_generated",
                message=None,
                data={
                    "length": len(cover_letter_text),
                    "requirement": cl_requirement.value,
                },
            )
        else:
            cover_letter_text = ""
            await emit_event(
                sf, job_id,
                phase="cover_letter_skipped",
                message="form has no cover letter field",
                data={"requirement": cl_requirement.value},
            )
```

Make sure `JobPosting` is already imported at the top of the file; if not, add `from app.models.job_posting import JobPosting`.

**Step 4: Run tests to verify they pass**

Run: `docker compose run --rm api pytest tests/test_prepare_skips_cover_letter_when_not_present.py tests/test_cover_letter_probe_resolver.py -v`
Expected: PASS.

Also run the existing prepare suite to catch regressions:

Run: `docker compose run --rm api pytest tests/ -k prepare -v`
Expected: PASS (existing prepare tests should still work — `generate_cover_letter` still gets called for any posting whose probe returns anything other than `NOT_PRESENT`, which is the default for postings with empty/missing meta).

**Step 5: Commit**

```bash
git add api/app/services/jobs_runner.py api/tests/test_prepare_skips_cover_letter_when_not_present.py
git commit -m "feat(api): prepare skips cover letter when posting form has no CL field"
```

---

## Task 9: Surface `cover_letter_requirement` on `ApplicationOut`

**Files:**
- Modify: `api/app/schemas/application.py` (or wherever `ApplicationOut` lives — find with `grep -rn "class ApplicationOut" api/app/schemas/`)
- Modify: `api/app/routes/applications.py` (the route that returns ApplicationOut — populate the new field from `posting.meta`)
- Test: `api/tests/test_applications_route.py` (extend an existing GET test, or add a new one)

**Step 1: Locate the schema**

Run: `grep -rn "class ApplicationOut\|class ApplicationDetail" api/app/schemas/ api/app/routes/applications.py`
Expected output: file path + line of the schema class.

**Step 2: Write the failing test**

Append to `api/tests/test_applications_route.py` (or wherever the `GET /applications/{id}` test lives):

```python
@pytest.mark.asyncio
async def test_application_detail_exposes_cover_letter_requirement(
    client, seeded_application_with_meta,
):
    # Pre-populate posting.meta["cover_letter"]["requirement"] = "not_present"
    app_id = seeded_application_with_meta.id
    resp = await client.get(f"/applications/{app_id}", cookies=valid_session_cookie)
    assert resp.status_code == 200
    body = resp.json()
    assert body["cover_letter_requirement"] == "not_present"
```

> Adapt the fixture name to match existing test scaffolding in this file.

**Step 3: Run test to verify it fails**

Run: `docker compose run --rm api pytest tests/test_applications_route.py -v -k cover_letter_requirement`
Expected: FAIL.

**Step 4: Implement**

Add to the schema class (e.g., `ApplicationOut`):

```python
    cover_letter_requirement: str = "unknown"  # "required" | "optional" | "not_present" | "unknown"
```

In the route handler that builds `ApplicationOut`, after loading the application + posting, set:

```python
    cover_letter_requirement=(
        ((posting.meta or {}).get("cover_letter") or {}).get("requirement", "unknown")
    ),
```

**Step 5: Run test to verify it passes**

Run: `docker compose run --rm api pytest tests/test_applications_route.py -v -k cover_letter_requirement`
Expected: PASS.

Also run the full applications route suite for regressions:

Run: `docker compose run --rm api pytest tests/test_applications_route.py -v`
Expected: PASS.

**Step 6: Commit**

```bash
git add api/app/schemas/application.py api/app/routes/applications.py api/tests/test_applications_route.py
git commit -m "feat(api): expose cover_letter_requirement on ApplicationOut"
```

---

## Task 10: Frontend — type field + QueueCard badge

**Files:**
- Modify: `web/src/api.ts` (add field to `Application` type)
- Modify: `web/src/components/QueueCard.tsx` (render badge)
- Test: `web/src/components/QueueCard.test.tsx`

**Step 1: Write the failing tests**

Append to `web/src/components/QueueCard.test.tsx`:

```typescript
test("renders 'Cover letter required' badge when cover_letter_requirement === 'required'", () => {
  render(
    <QueueCard
      application={{ ...baseApplication, cover_letter_requirement: "required" }}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByText(/cover letter required/i)).toBeInTheDocument();
});

test("renders 'No cover letter field' badge when cover_letter_requirement === 'not_present'", () => {
  render(
    <QueueCard
      application={{ ...baseApplication, cover_letter_requirement: "not_present" }}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByText(/no cover letter field/i)).toBeInTheDocument();
});

test("renders 'Cover letter optional' badge when cover_letter_requirement === 'optional'", () => {
  render(
    <QueueCard
      application={{ ...baseApplication, cover_letter_requirement: "optional" }}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByText(/cover letter optional/i)).toBeInTheDocument();
});

test("renders 'Cover letter unknown' badge when cover_letter_requirement === 'unknown'", () => {
  render(
    <QueueCard
      application={{ ...baseApplication, cover_letter_requirement: "unknown" }}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByText(/cover letter unknown/i)).toBeInTheDocument();
});
```

> If `baseApplication` doesn't exist in this test file, scan the file for an existing application object literal used in other tests and copy its shape.

**Step 2: Run tests to verify they fail**

Run: `docker compose run --rm web npm test -- --run components/QueueCard.test.tsx`
Expected: 4 new tests FAIL.

**Step 3: Implement**

In `web/src/api.ts`, find the `Application` type and add:

```typescript
  cover_letter_requirement?: "required" | "optional" | "not_present" | "unknown";
```

In `web/src/components/QueueCard.tsx`, near the top of the card body (e.g., next to the existing status pill), render:

```tsx
{application.cover_letter_requirement && (
  <span
    data-testid="cover-letter-badge"
    style={{
      fontSize: 11,
      padding: "2px 8px",
      borderRadius: 4,
      background: "var(--surface-2)",
      color: "var(--ink-2)",
      border: "1px solid var(--rule)",
    }}
  >
    {COVER_LETTER_LABELS[application.cover_letter_requirement]}
  </span>
)}
```

And add this constant near the other module-level constants:

```tsx
const COVER_LETTER_LABELS: Record<string, string> = {
  required: "Cover letter required",
  optional: "Cover letter optional",
  not_present: "No cover letter field",
  unknown: "Cover letter unknown",
};
```

**Step 4: Run tests to verify they pass**

Run: `docker compose run --rm web npm test -- --run components/QueueCard.test.tsx`
Expected: PASS.

**Step 5: Manual smoke test**

- Hit the running stack at http://localhost:5173/queue.
- Verify the existing Loop application shows a badge (will say "Cover letter unknown" until the next prepare re-runs the probe).
- Re-prepare the Loop posting from Inbox and verify badge updates to whatever Greenhouse reports.

**Step 6: Commit**

```bash
git add web/src/api.ts web/src/components/QueueCard.tsx web/src/components/QueueCard.test.tsx
git commit -m "feat(web): cover-letter requirement badge on QueueCard"
```

---

## Task 11: Live integration tests (skipped in CI)

**Files:**
- Create: `api/tests/test_cover_letter_probe_live.py`
- Modify: `api/pyproject.toml` (register `live` marker if not already)

**Background:** One real-world probe per source against a known-stable apply URL. Catches API drift. Marked `@pytest.mark.live` and skipped unless explicitly run with `pytest -m live`.

**Step 1: Add the marker (if missing)**

Check `api/pyproject.toml` for `[tool.pytest.ini_options]` → `markers`. If `live` isn't listed, add:

```toml
markers = [
  "live: hits real third-party APIs; opt-in via -m live",
]
```

**Step 2: Write the live tests**

Create `api/tests/test_cover_letter_probe_live.py`:

```python
"""Live probes — skipped by default. Run with: pytest -m live"""
import httpx
import pytest

from app.services.sources.greenhouse import greenhouse_source
from app.services.sources.lever import lever_source
from app.services.sources.workable import workable_source
from app.services.sources.ashby import ashby_source
from app.services.sources.protocol import CoverLetterRequirement


pytestmark = pytest.mark.live


@pytest.mark.asyncio
async def test_greenhouse_live_loop():
    # Replace with any current Loop posting URL if this one expires.
    url = "https://job-boards.greenhouse.io/loop/jobs/5981831004"
    async with httpx.AsyncClient() as http:
        result = await greenhouse_source.probe_cover_letter({"slug": "loop"}, url, http=http)
    assert result is not CoverLetterRequirement.UNKNOWN


# Add one stable URL per source; mark with skip + reason if a stable URL
# isn't readily available.
```

**Step 3: Verify default run skips them**

Run: `docker compose run --rm api pytest tests/test_cover_letter_probe_live.py -v`
Expected: 1 SKIPPED.

**Step 4: Verify opt-in works**

Run: `docker compose run --rm api pytest -m live tests/test_cover_letter_probe_live.py -v`
Expected: 1 PASSED (assuming network + URL stable).

**Step 5: Commit**

```bash
git add api/tests/test_cover_letter_probe_live.py api/pyproject.toml
git commit -m "test(api): live cover-letter probe tests, opt-in via -m live"
```

---

## Task 12: Manual end-to-end verification

**Step 1: Restart stack with all changes**

Run: `docker compose up -d --build api worker web`
Expected: containers healthy.

**Step 2: Force re-probe of the existing Loop posting**

Run:

```bash
docker compose exec -T db psql -U hirescript -d hirescript -c \
  "UPDATE job_postings SET meta = meta - 'cover_letter' WHERE id = 653;"
```

(Removes the cached probe result so the next prepare runs the probe fresh.)

**Step 3: Re-prepare and inspect**

- In the UI, Inbox → Loop posting → Prepare.
- Watch `docker compose logs -f worker` for the `cover_letter_generated` or `cover_letter_skipped` event.
- Refresh Queue tab; verify QueueCard shows the appropriate badge.

**Step 4: Verify cached meta**

Run:

```bash
docker compose exec -T db psql -U hirescript -d hirescript -c \
  "SELECT meta->'cover_letter' FROM job_postings WHERE id = 653;"
```

Expected: JSON with `requirement` and `probed_at` keys.

**Step 5: No commit (manual verification only).**

---

## Out of Scope (explicit non-goals)

- Triggering re-probe when a probe result is older than N days. Acceptable for now — postings are short-lived.
- Per-question detail (e.g., "cover letter must be 200+ words"). Greenhouse exposes constraints but generation today doesn't honor them; would belong in a separate plan.
- Probing during ingest. Confirmed lazy-at-prepare during planning.
- Recording probe latency / hit rates as metrics. Add when we have an observability story.
