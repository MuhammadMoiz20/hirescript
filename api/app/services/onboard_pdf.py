from app.services.agent import query_json, AgentError

_SYSTEM = """\
You convert raw resume text into a structured JSON object that matches an internal schema.
Return ONLY a JSON object with this shape (no markdown, no commentary):

{
  "header": {
    "name": "<full name>",
    "tagline": "<short professional tagline or empty string>",
    "contacts": [{"label": "email"|"phone"|"linkedin"|"github"|"link", "value": "<text>", "url": null|"<url>"}, ...]
  },
  "education": [{"institution": "...", "location": "...", "degree": "...", "date": "...", "bullets": ["...", ...]}, ...],
  "experience": [{"institution": "<company>", "location": "...", "degree": "<role/title>", "date": "<dates>", "bullets": ["...", ...]}, ...],
  "projects": [{"name": "...", "tech": "...", "date": "", "bullets": ["...", ...]}, ...],
  "skills": {"<group label>": "<comma-separated values>", ...}
}

Rules:
- Use bullets verbatim from the source where reasonable; clean up obvious OCR/PDF-extraction artifacts but do not invent content.
- Bullet strings are plain text (no LaTeX). The renderer adds formatting.
- For experience entries, "institution" is the company and "degree" is the role/title (matches the source LaTeX template's argument order).
- If a section is missing in the source, return it as an empty list/object.
- Output a single JSON object only, no surrounding text.
"""


async def map_pdf_to_jakes_content(*, raw_text: str) -> dict:
    if not raw_text.strip():
        raise AgentError("empty source text")
    data = await query_json(system_prompt=_SYSTEM, user_prompt=raw_text, tier="sonnet")
    if not isinstance(data, dict):
        raise AgentError(f"expected JSON object, got {type(data).__name__}")
    # Backfill any missing top-level keys with safe defaults
    data.setdefault("header", {"name": "", "tagline": "", "contacts": []})
    data.setdefault("education", [])
    data.setdefault("experience", [])
    data.setdefault("projects", [])
    data.setdefault("skills", {})
    return data
