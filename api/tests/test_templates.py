from app.templates import get_template, list_templates

def test_jakes_template_is_registered():
    ids = [t["id"] for t in list_templates()]
    assert "jakes" in ids

def test_get_template_returns_latex_skeleton():
    tpl = get_template("jakes")
    assert tpl["id"] == "jakes"
    assert "\\documentclass" in tpl["latex_skeleton"]
