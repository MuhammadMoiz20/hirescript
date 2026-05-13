from datetime import datetime, timezone

from app.schemas import (
    OnboardTexRequest,
    OnboardedResumeOut,
    ResumeCreate,
    ResumeOut,
    TailorRequest,
    VariantOut,
)


def test_resume_create_default_one_line_false():
    r = ResumeCreate(name="My Resume", template_id="classic")
    assert r.one_line_per_bullet is False


def test_resume_create_explicit_true_preserved():
    r = ResumeCreate(name="X", template_id="classic", one_line_per_bullet=True)
    assert r.one_line_per_bullet is True


def test_resume_create_explicit_false_preserved():
    r = ResumeCreate(name="X", template_id="classic", one_line_per_bullet=False)
    assert r.one_line_per_bullet is False


def test_onboard_tex_default_one_line_false():
    r = OnboardTexRequest(name="X", latex_source="\\documentclass{article}")
    assert r.one_line_per_bullet is False


def test_onboard_tex_explicit_true_preserved():
    r = OnboardTexRequest(
        name="X", latex_source="...", one_line_per_bullet=True
    )
    assert r.one_line_per_bullet is True


def test_onboard_tex_explicit_false_preserved():
    r = OnboardTexRequest(
        name="X", latex_source="...", one_line_per_bullet=False
    )
    assert r.one_line_per_bullet is False


def test_tailor_request_default_one_line_none():
    r = TailorRequest(title="t", company="c", jd_text="jd")
    assert r.one_line_per_bullet is None


def test_tailor_request_explicit_true_preserved():
    r = TailorRequest(title="t", company="c", jd_text="jd", one_line_per_bullet=True)
    assert r.one_line_per_bullet is True


def test_tailor_request_explicit_false_preserved():
    r = TailorRequest(title="t", company="c", jd_text="jd", one_line_per_bullet=False)
    assert r.one_line_per_bullet is False


def _resume_dict(**overrides):
    base = {
        "id": 1,
        "name": "R",
        "template_id": "classic",
        "kind": "master",
        "latex_source": "\\documentclass{article}",
        "updated_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
        "one_line_per_bullet": True,
    }
    base.update(overrides)
    return base


def test_resume_out_serializes_one_line_per_bullet():
    r = ResumeOut.model_validate(_resume_dict(one_line_per_bullet=True))
    assert r.one_line_per_bullet is True
    dumped = r.model_dump()
    assert dumped["one_line_per_bullet"] is True


def test_resume_out_one_line_per_bullet_false():
    r = ResumeOut.model_validate(_resume_dict(one_line_per_bullet=False))
    assert r.one_line_per_bullet is False


def test_onboarded_resume_out_inherits_flag():
    payload = _resume_dict(one_line_per_bullet=True)
    payload.update({"enforced": True, "iterations": 1, "page_count": 1})
    r = OnboardedResumeOut.model_validate(payload)
    assert r.one_line_per_bullet is True


def test_variant_out_inherits_flag():
    payload = _resume_dict(one_line_per_bullet=False, kind="variant")
    payload.update({"parent_id": 1, "job_description_id": None})
    r = VariantOut.model_validate(payload)
    assert r.one_line_per_bullet is False
