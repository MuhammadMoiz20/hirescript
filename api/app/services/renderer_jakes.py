"""Renderer: structured ``content_json`` → Jake's-format LaTeX document."""

from __future__ import annotations

from pathlib import Path

_PREAMBLE = (
    Path(__file__).resolve().parents[1] / "templates" / "jakes_preamble.tex"
).read_text()


def _render_header(header: dict) -> str:
    name = header.get("name", "").strip()
    tagline = header.get("tagline", "").strip()
    contacts = header.get("contacts", []) or []

    lines: list[str] = []
    lines.append("\\begin{center}")
    if name:
        lines.append(f"  \\textbf{{\\Huge\\scshape {name}}} \\\\ \\vspace{{2pt}}")
    lines.append("  \\small")

    contact_parts: list[str] = []
    for c in contacts:
        url = c.get("url")
        value = c.get("value", "").strip()
        if not value:
            continue
        if url:
            contact_parts.append(
                f"\\href{{{url}}}{{\\underline{{{value}}}}}"
            )
        else:
            contact_parts.append(value)
    if contact_parts:
        separator = " $|$\n  "
        lines.append("  " + separator.join(contact_parts) + " \\\\ \\vspace{3pt}")

    if tagline:
        lines.append(f"  \\textbf{{{tagline}}}")
    lines.append("\\end{center}")
    return "\n".join(lines)


def _render_subheading_entries(entries: list[dict]) -> str:
    if not entries:
        return "  \\resumeSubHeadingListStart\n  \\resumeSubHeadingListEnd"
    out: list[str] = ["  \\resumeSubHeadingListStart"]
    for e in entries:
        inst = e.get("institution", "")
        loc = e.get("location", "")
        degree = e.get("degree", "")
        date = e.get("date", "")
        out.append("    \\resumeSubheading")
        out.append(f"      {{{inst}}}{{{loc}}}")
        out.append(f"      {{{degree}}}{{{date}}}")
        bullets = e.get("bullets", []) or []
        if bullets:
            out.append("      \\resumeItemListStart")
            for b in bullets:
                out.append(f"        \\resumeItem{{{b}}}")
            out.append("      \\resumeItemListEnd")
    out.append("  \\resumeSubHeadingListEnd")
    return "\n".join(out)


def _render_project_entries(projects: list[dict]) -> str:
    if not projects:
        return "  \\resumeSubHeadingListStart\n  \\resumeSubHeadingListEnd"
    out: list[str] = ["  \\resumeSubHeadingListStart"]
    for p in projects:
        name = p.get("name", "")
        tech = p.get("tech", "")
        date = p.get("date", "")
        if tech:
            heading = f"\\textbf{{{name}}} $|$ \\emph{{{tech}}}"
        else:
            heading = f"\\textbf{{{name}}}"
        out.append("    \\resumeProjectHeading")
        out.append(f"      {{{heading}}}{{{date}}}")
        bullets = p.get("bullets", []) or []
        if bullets:
            out.append("      \\resumeItemListStart")
            for b in bullets:
                out.append(f"        \\resumeItem{{{b}}}")
            out.append("      \\resumeItemListEnd")
    out.append("  \\resumeSubHeadingListEnd")
    return "\n".join(out)


def _render_skills(skills: dict) -> str:
    if not skills:
        return (
            "\\begin{itemize}[leftmargin=0.15in, label={}]\n"
            "  \\small{\\item{}}\n"
            "\\end{itemize}"
        )
    lines: list[str] = []
    lines.append("\\begin{itemize}[leftmargin=0.15in, label={}]")
    lines.append("  \\small{\\item{")
    items = list(skills.items())
    for idx, (group, value) in enumerate(items):
        suffix = " \\\\" if idx < len(items) - 1 else ""
        lines.append(f"    \\textbf{{{group}}}{{: {value}}}{suffix}")
    lines.append("  }}")
    lines.append("\\end{itemize}")
    return "\n".join(lines)


def render_jakes(content_json: dict) -> str:
    """Render ``content_json`` back into a Jake's-format LaTeX document."""
    header = content_json.get("header", {}) or {}
    education = content_json.get("education", []) or []
    experience = content_json.get("experience", []) or []
    projects = content_json.get("projects", []) or []
    skills = content_json.get("skills", {}) or {}

    parts: list[str] = []
    parts.append(_PREAMBLE.rstrip())
    parts.append("")
    parts.append("\\begin{document}")
    parts.append("")
    parts.append(_render_header(header))
    parts.append("")
    parts.append("\\section{Education}")
    parts.append(_render_subheading_entries(education))
    parts.append("")
    parts.append("\\section{Experience}")
    parts.append(_render_subheading_entries(experience))
    parts.append("")
    parts.append("\\section{Projects}")
    parts.append(_render_project_entries(projects))
    parts.append("")
    parts.append("\\section{Technical Skills}")
    parts.append(_render_skills(skills))
    parts.append("")
    parts.append("\\end{document}")
    parts.append("")
    return "\n".join(parts)
