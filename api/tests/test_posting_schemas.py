from datetime import datetime, timezone

from app.schemas.application import ApplicationOut
from app.schemas.posting import JobPostingOut


def test_job_posting_out_instantiates():
    p = JobPostingOut(
        id=1,
        source="greenhouse",
        source_job_id="abc123",
        company="Anthropic",
        title="Software Engineer",
        location="San Francisco",
        apply_url="https://boards.greenhouse.io/anthropic/jobs/abc123",
        tier="dream",
        fit_score=87,
        status="classified",
        ingested_at=datetime.now(timezone.utc),
    )
    assert p.company == "Anthropic"
    assert p.fit_score == 87
    assert p.tier == "dream"


def test_application_out_instantiates_with_posting():
    posting = JobPostingOut(
        id=1,
        source="greenhouse",
        source_job_id="abc123",
        company="Anthropic",
        title="Software Engineer",
        location=None,
        apply_url="https://boards.greenhouse.io/anthropic/jobs/abc123",
        tier=None,
        fit_score=None,
        status="ready",
        ingested_at=datetime.now(timezone.utc),
    )
    app = ApplicationOut(
        id=10,
        posting_id=1,
        posting=posting,
        status="prepared",
        mode="B",
        cover_letter_text="Dear hiring team...",
        form_payload={"first_name": "Ada"},
        submitted_at=None,
        error=None,
    )
    assert app.posting.company == "Anthropic"
    assert app.mode == "B"
    assert app.form_payload == {"first_name": "Ada"}


def test_jobposting_out_allows_company_none():
    p = JobPostingOut(
        id=2, source="greenhouse", source_job_id="xyz",
        company=None, title="SWE", location="Remote",
        apply_url="https://...", tier=None, fit_score=None,
        status="new", ingested_at=datetime(2026, 4, 26),
    )
    assert p.company is None
