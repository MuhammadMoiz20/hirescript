from app.services.renderer_jakes import render_jakes


def test_renders_minimal_doc_includes_documentclass_and_end_document():
    doc = render_jakes({
        "header": {"name": "X", "tagline": "Y", "contacts": []},
        "education": [], "experience": [], "projects": [], "skills": {},
    })
    assert "\\documentclass" in doc
    assert "\\begin{document}" in doc
    assert "\\end{document}" in doc


def test_renders_education_subheading():
    doc = render_jakes({
        "header": {"name": "X", "tagline": "", "contacts": []},
        "education": [{
            "institution": "Dart",
            "location": "NH",
            "degree": "B.S.",
            "date": "2026",
            "bullets": ["one"],
        }],
        "experience": [], "projects": [], "skills": {},
    })
    assert "\\resumeSubheading" in doc
    assert "Dart" in doc and "B.S." in doc and "2026" in doc
    assert "\\resumeItem{one}" in doc
