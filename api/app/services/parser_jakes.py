"""Parser for Jake's-formatted LaTeX resumes.

Produces a structured ``content_json`` representation suitable for a form-based
section editor. Round-trips with :mod:`app.services.renderer_jakes`.
"""

from __future__ import annotations

import re
from typing import Optional


def _match_balanced_group(s: str, start: int) -> Optional[tuple[str, int]]:
    """Given a string and an index pointing at ``{``, return (inner, end_index).

    ``end_index`` is the index just past the matching ``}``. Returns None if no
    balanced group is found.
    """
    if start >= len(s) or s[start] != "{":
        return None
    depth = 0
    i = start
    while i < len(s):
        c = s[i]
        if c == "\\" and i + 1 < len(s):
            i += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return s[start + 1 : i], i + 1
        i += 1
    return None


def _read_args(s: str, start: int, n: int) -> Optional[tuple[list[str], int]]:
    """Read ``n`` consecutive ``{...}`` brace groups starting at index ``start``.

    Whitespace between groups is skipped. Returns (list_of_inner_strings, next_index).
    """
    args: list[str] = []
    i = start
    for _ in range(n):
        while i < len(s) and s[i] in " \t\r\n":
            i += 1
        m = _match_balanced_group(s, i)
        if m is None:
            return None
        inner, i = m
        args.append(inner)
    return args, i


def _classify_contact(url: Optional[str], text: str) -> str:
    haystack = (url or "") + " " + text
    low = haystack.lower()
    if "mailto:" in low or "@" in text:
        return "email"
    if "linkedin" in low:
        return "linkedin"
    if "github" in low:
        return "github"
    return "link"


def _parse_header(latex: str) -> dict:
    """Parse the first ``\\begin{center} ... \\end{center}`` block."""
    m = re.search(r"\\begin\{center\}(.*?)\\end\{center\}", latex, re.DOTALL)
    header: dict = {"name": "", "tagline": "", "contacts": []}
    if not m:
        return header
    body = m.group(1)

    name_m = re.search(r"\\textbf\{\\Huge\\scshape\s+([^}]+)\}", body)
    if name_m:
        header["name"] = name_m.group(1).strip()

    contacts: list[dict] = []
    # \href{url}{\underline{text}}
    for href_m in re.finditer(
        r"\\href\{([^}]+)\}\{\\underline\{([^}]+)\}\}", body
    ):
        url = href_m.group(1).strip()
        text = href_m.group(2).strip()
        contacts.append(
            {"label": _classify_contact(url, text), "value": text, "url": url}
        )

    # Bare phone-like segments (e.g. "(603) 349-0579"). Look between $|$ separators.
    for phone_m in re.finditer(r"\(\d{2,4}\)\s*\d{3}[-\s]?\d{4}", body):
        val = phone_m.group(0).strip()
        contacts.append({"label": "phone", "value": val, "url": None})

    header["contacts"] = contacts

    # Tagline: final \textbf{...} that is NOT the \Huge\scshape one.
    textbfs = list(re.finditer(r"\\textbf\{", body))
    if len(textbfs) >= 2:
        # Grab balanced group after the last \textbf{
        last = textbfs[-1]
        inner = _match_balanced_group(body, last.end() - 1)
        if inner is not None:
            candidate = inner[0].strip()
            if "\\Huge" not in candidate:
                header["tagline"] = candidate

    return header


def _extract_section(latex: str, title: str) -> Optional[str]:
    """Return the body of ``\\section{title}`` up to next ``\\section`` or end of doc."""
    pattern = r"\\section\{" + re.escape(title) + r"\}(.*?)(?=\\section\{|\\end\{document\})"
    m = re.search(pattern, latex, re.DOTALL)
    return m.group(1) if m else None


def _parse_items(body: str) -> list[str]:
    """Return list of raw inner contents of ``\\resumeItem{...}`` in order."""
    items: list[str] = []
    for m in re.finditer(r"\\resumeItem\s*", body):
        inner = _match_balanced_group(body, m.end())
        if inner is None:
            continue
        items.append(inner[0].strip())
    return items


def _parse_subheading_entries(body: str) -> list[dict]:
    """Parse ``\\resumeSubheading{A}{B}{C}{D}`` blocks with optional item lists."""
    entries: list[dict] = []
    if body is None:
        return entries
    # Find each \resumeSubheading in order.
    matches = list(re.finditer(r"\\resumeSubheading\s*", body))
    for idx, m in enumerate(matches):
        args = _read_args(body, m.end(), 4)
        if args is None:
            continue
        (inst, loc, degree, date), end_idx = args
        # Everything between end_idx and the next \resumeSubheading (or end) is the
        # potential item list.
        next_start = matches[idx + 1].start() if idx + 1 < len(matches) else len(body)
        chunk = body[end_idx:next_start]
        list_m = re.search(
            r"\\resumeItemListStart(.*?)\\resumeItemListEnd", chunk, re.DOTALL
        )
        bullets = _parse_items(list_m.group(1)) if list_m else []
        entries.append(
            {
                "institution": inst.strip(),
                "location": loc.strip(),
                "degree": degree.strip(),
                "date": date.strip(),
                "bullets": bullets,
            }
        )
    return entries


def _split_project_heading(arg1: str) -> tuple[str, str]:
    """Split ``\\textbf{Name} $|$ \\emph{Tech}`` → (name, tech)."""
    name = ""
    tech = ""
    name_m = re.search(r"\\textbf\s*", arg1)
    if name_m:
        inner = _match_balanced_group(arg1, name_m.end())
        if inner is not None:
            name = inner[0].strip()
    tech_m = re.search(r"\\emph\s*", arg1)
    if tech_m:
        inner = _match_balanced_group(arg1, tech_m.end())
        if inner is not None:
            tech = inner[0].strip()
    if not name and not tech:
        # Fallback: treat the whole arg as name.
        name = arg1.strip()
    return name, tech


def _parse_project_entries(body: Optional[str]) -> list[dict]:
    entries: list[dict] = []
    if body is None:
        return entries
    matches = list(re.finditer(r"\\resumeProjectHeading\s*", body))
    for idx, m in enumerate(matches):
        args = _read_args(body, m.end(), 2)
        if args is None:
            continue
        (arg1, date), end_idx = args
        name, tech = _split_project_heading(arg1)
        next_start = matches[idx + 1].start() if idx + 1 < len(matches) else len(body)
        chunk = body[end_idx:next_start]
        list_m = re.search(
            r"\\resumeItemListStart(.*?)\\resumeItemListEnd", chunk, re.DOTALL
        )
        bullets = _parse_items(list_m.group(1)) if list_m else []
        entries.append(
            {
                "name": name,
                "tech": tech,
                "date": date.strip(),
                "bullets": bullets,
            }
        )
    return entries


def _parse_skills(body: Optional[str]) -> dict:
    """Parse ``\\textbf{Group}{: value} \\\\`` lines."""
    groups: dict[str, str] = {}
    if body is None:
        return groups
    # Match every \textbf{LABEL}{: VALUE} — VALUE is the next brace group after the label.
    i = 0
    while True:
        m = re.search(r"\\textbf\s*", body[i:])
        if not m:
            break
        start = i + m.end()
        label_group = _match_balanced_group(body, start)
        if label_group is None:
            i = start
            continue
        label, after_label = label_group
        # Skip whitespace between brace groups
        j = after_label
        while j < len(body) and body[j] in " \t\r\n":
            j += 1
        if j < len(body) and body[j] == "{":
            value_group = _match_balanced_group(body, j)
            if value_group is not None:
                value, after_value = value_group
                value = value.lstrip(": ").strip()
                if label.strip() and value:
                    groups[label.strip()] = value
                i = after_value
                continue
        i = after_label
    return groups


def parse_jakes(latex: str) -> dict:
    """Parse a Jake's-formatted LaTeX resume into structured content_json.

    Returns:
      {
        "header": {"name", "tagline", "contacts": [...]},
        "education":  [<entry>, ...],
        "experience": [<entry>, ...],
        "projects":   [<project>, ...],
        "skills":     {"<group>": "<comma-separated string>", ...}
      }
    """
    header = _parse_header(latex)
    edu_body = _extract_section(latex, "Education")
    exp_body = _extract_section(latex, "Experience")
    proj_body = _extract_section(latex, "Projects")
    skills_body = _extract_section(latex, "Technical Skills")

    return {
        "header": header,
        "education": _parse_subheading_entries(edu_body or ""),
        "experience": _parse_subheading_entries(exp_body or ""),
        "projects": _parse_project_entries(proj_body),
        "skills": _parse_skills(skills_body),
    }
