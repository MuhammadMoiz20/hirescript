from pathlib import Path

import pytest

from app.services.parser_jakes import parse_jakes

SOURCE = (
    Path(__file__).resolve().parents[1] / "app" / "templates" / "jakes_skeleton.tex"
).read_text()


def test_parses_header_name():
    j = parse_jakes(SOURCE)
    assert j["header"]["name"] == "Muhammad Moiz"


def test_parses_education_first_entry():
    j = parse_jakes(SOURCE)
    edu0 = j["education"][0]
    assert edu0["institution"] == "Dartmouth College"
    assert edu0["location"] == "Hanover, NH"
    assert "Computer Science" in edu0["degree"]
    assert edu0["date"].startswith("Exp")
    assert any("IvyHacks" in b for b in edu0["bullets"])


def test_parses_experience_count_matches_seed():
    j = parse_jakes(SOURCE)
    # The seeded resume has 6 experience entries
    assert len(j["experience"]) == 6
    first = j["experience"][0]
    assert first["institution"] == "Evergreen"
    assert first["degree"] == "Software Engineering Co-op"


def test_parses_projects():
    j = parse_jakes(SOURCE)
    names = [p["name"] for p in j["projects"]]
    assert "Classmoji (Open Source)" in names or "Classmoji" in str(names)


def test_parses_skills_groups():
    j = parse_jakes(SOURCE)
    assert "Languages" in j["skills"]
    assert "Python" in j["skills"]["Languages"]


def test_bullets_preserve_textbf():
    j = parse_jakes(SOURCE)
    # at least one bullet should still contain \textbf
    flat = [b for e in j["experience"] for b in e["bullets"]]
    assert any("\\textbf" in b for b in flat)
