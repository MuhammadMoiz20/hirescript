from datetime import date

import pytest

from app.schemas.profile import Position, Profile, WorkAuth


def test_minimal_profile_validates():
    p = Profile(legal_name="Moiz", email="m@x.com")
    assert p.legal_name == "Moiz"
    assert p.work_auth == WorkAuth()  # default empty
    assert p.positions == []


def test_position_requires_dates_in_order():
    with pytest.raises(ValueError):
        Position(
            company="X",
            title="Y",
            start=date(2024, 1, 1),
            end=date(2023, 1, 1),
        )


def test_dealbreakers_default_empty_list():
    p = Profile(legal_name="Moiz", email="m@x.com")
    assert p.preferences.dealbreakers == []
