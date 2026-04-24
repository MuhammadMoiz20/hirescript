"""Section schema for Jake's Resume template."""

# High-level ordering and types of sections in a Jake's-format resume.
JAKES_SECTIONS = [
    {"id": "header",     "type": "header"},
    {"id": "education",  "type": "list_subheading", "title": "Education"},
    {"id": "experience", "type": "list_subheading", "title": "Experience"},
    {"id": "projects",   "type": "list_project",    "title": "Projects"},
    {"id": "skills",     "type": "key_value_list",  "title": "Technical Skills"},
]


# Per-row schemas (used by the form editor). Names are field keys; values are display labels.
SUBHEADING_FIELDS = {
    "institution": "Institution",
    "location":    "Location",
    "degree":      "Title / Degree",
    "date":        "Date",
}

PROJECT_FIELDS = {
    "name": "Name",
    "tech": "Tech",
    "date": "Date",
}


def get_section_schema(template_id: str):
    if template_id == "jakes":
        return {
            "sections": JAKES_SECTIONS,
            "subheading_fields": SUBHEADING_FIELDS,
            "project_fields": PROJECT_FIELDS,
        }
    raise KeyError(template_id)
