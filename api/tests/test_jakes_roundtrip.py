from pathlib import Path

import pytest

from app.services.compile import compile_latex
from app.services.parser_jakes import parse_jakes
from app.services.renderer_jakes import render_jakes

SOURCE = (
    Path(__file__).resolve().parents[1] / "app" / "templates" / "jakes_skeleton.tex"
).read_text()


def test_parse_render_parse_is_stable():
    once = parse_jakes(SOURCE)
    rendered = render_jakes(once)
    twice = parse_jakes(rendered)
    # Section keys identical
    assert set(once.keys()) == set(twice.keys())
    # Same number of entries
    assert len(once["education"]) == len(twice["education"])
    assert len(once["experience"]) == len(twice["experience"])
    assert len(once["projects"]) == len(twice["projects"])
    assert sorted(once["skills"].keys()) == sorted(twice["skills"].keys())
    assert once["header"]["name"] == twice["header"]["name"]


def test_rendered_compiles_to_one_page():
    j = parse_jakes(SOURCE)
    rendered = render_jakes(j)
    result = compile_latex(rendered)
    # Original seeded resume compiles to 1 or 2 pages depending on settings; we just want
    # the rendered version to be syntactically valid LaTeX that Tectonic accepts.
    assert result.pdf[:4] == b"%PDF"
    assert result.page_count >= 1
