from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.schemas.notification import NotificationOut
from app.schemas.tier import TierOut, TierUpdate


def test_tier_out_instantiates():
    t = TierOut(
        id=1,
        slug="targeted",
        display_name="Targeted",
        min_fit_score=65,
        daily_cap=20,
        default_mode="A",
        tailor_model="sonnet-4.6",
        classify_model="haiku-4.5",
        enabled=True,
        updated_at=datetime.now(timezone.utc),
    )
    assert t.slug == "targeted"
    assert t.default_mode == "A"


def test_tier_update_allows_mutable_fields():
    u = TierUpdate(
        daily_cap=10,
        default_mode="B",
        tailor_model="opus-4.7",
        enabled=False,
    )
    assert u.daily_cap == 10
    assert u.default_mode == "B"
    assert u.tailor_model == "opus-4.7"
    assert u.enabled is False


def test_tier_update_partial_is_ok():
    u = TierUpdate(daily_cap=5)
    dumped = u.model_dump(exclude_unset=True)
    assert dumped == {"daily_cap": 5}


def test_tier_update_rejects_invalid_default_mode():
    with pytest.raises(ValidationError):
        TierUpdate(default_mode="C")


def test_tier_update_rejects_invalid_tailor_model():
    with pytest.raises(ValidationError):
        TierUpdate(tailor_model="gpt-4")


def test_tier_update_rejects_immutable_fields():
    # `slug` and `min_fit_score` must not be settable through TierUpdate.
    with pytest.raises(ValidationError):
        TierUpdate(slug="dream")  # type: ignore[call-arg]
    with pytest.raises(ValidationError):
        TierUpdate(min_fit_score=99)  # type: ignore[call-arg]


def test_notification_out_instantiates():
    n = NotificationOut(
        id=1,
        user_id=1,
        kind="captcha_pause",
        title="Captcha encountered",
        body="Resume application 12 manually.",
        meta={"application_id": 12},
        delivered_at=None,
        read_at=None,
        created_at=datetime.now(timezone.utc),
    )
    assert n.kind == "captcha_pause"
    assert n.meta == {"application_id": 12}
