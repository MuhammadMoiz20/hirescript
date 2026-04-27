import io
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from pypdf import PdfReader

from app.services.latex_shim import WRAP_SHIM

class CompileError(RuntimeError):
    def __init__(self, stderr: str):
        super().__init__(stderr)
        self.stderr = stderr

@dataclass(frozen=True)
class OverflowHint:
    """A single 'Overfull \\hbox' from the Tectonic log."""
    overflow_pt: float
    line_start: int
    line_end: int
    snippet: str  # the offending text fragment as TeX echoed it (cleaned)


@dataclass(frozen=True)
class CompileResult:
    pdf: bytes
    page_count: int
    overflows: tuple[OverflowHint, ...] = ()


_OVERFULL_RE = re.compile(
    r"Overfull \\hbox \(([\d.]+)pt too wide\).*?at lines (\d+)--(\d+)",
    re.DOTALL,
)


_WRAP_RE = re.compile(
    r"HS_WRAP: line=(\d+) over=([\d.]+)pt limit=([\d.]+)pt text=<<<(.*?)>>>"
)


def _strip_tex_font_prefix(line: str) -> str:
    """Tectonic prints offending lines like '[]\\OT1/cmr/m/n/10.95 the actual text'.
    Strip the bracket and font-spec prefix so the LLM sees readable prose."""
    line = line.strip()
    if line.startswith("[]"):
        line = line[2:].lstrip()
    # Strip a leading TeX font selector, e.g. \OT1/cmr/m/n/10.95 or \T1/cmr/bx/n/10
    line = re.sub(r"^\\[A-Za-z0-9]+/[\w/.]+ ", "", line)
    return line


def parse_overflows(log: str) -> tuple[OverflowHint, ...]:
    """Extract overflow hints from Tectonic's combined log output.

    Two sources:
      * Overfull \\hbox warnings — emitted by TeX when a line cannot be broken
        and exceeds \\hsize.
      * HS_WRAP: ... lines — emitted by our preamble shim when a bullet or
        skill row's measured width exceeds \\linewidth, indicating a soft
        wrap that TeX silently broke at a space.
    Hints are returned in the order they appear in the log so callers can
    reason about them positionally.
    """
    hints: list[tuple[int, OverflowHint]] = []
    # TeX wraps log output at ~79 chars (max_print_line), so a long
    # HS_WRAP: ... text=<<<...>>> emission spans multiple physical lines.
    # Reassemble each HS_WRAP entry into a single logical line before
    # scanning, while keeping non-HS_WRAP lines untouched so the
    # Overfull \\hbox snippet-extraction below still works.
    raw_lines = log.splitlines()
    lines: list[str] = []
    i = 0
    while i < len(raw_lines):
        cur = raw_lines[i]
        if cur.lstrip().startswith("HS_WRAP:") and ">>>" not in cur:
            # Cap lookahead so a truncated/malformed HS_WRAP entry (no closing
            # '>>>') cannot swallow the rest of the log and hide subsequent
            # Overfull \hbox warnings. After 8 attempts without a terminator,
            # drop the malformed line as-is (won't match _WRAP_RE) and
            # continue scanning from the next raw line.
            MAX_LOOKAHEAD = 8
            joined = cur
            j = i + 1
            attempts = 0
            while j < len(raw_lines) and ">>>" not in joined and attempts < MAX_LOOKAHEAD:
                joined += raw_lines[j]
                j += 1
                attempts += 1
            if ">>>" in joined:
                lines.append(joined)
                i = j
            else:
                lines.append(cur)
                i += 1
            continue
        lines.append(cur)
        i += 1
    for idx, line in enumerate(lines):
        m = _OVERFULL_RE.search(line)
        if m:
            snippet = ""
            for j in range(idx + 1, min(idx + 4, len(lines))):
                candidate = lines[j].strip()
                if not candidate:
                    continue
                if candidate.startswith("[]") or candidate.startswith("\\"):
                    snippet = _strip_tex_font_prefix(candidate)
                    break
            hints.append((idx, OverflowHint(
                overflow_pt=float(m.group(1)),
                line_start=int(m.group(2)),
                line_end=int(m.group(3)),
                snippet=snippet,
            )))
            continue
        w = _WRAP_RE.search(line)
        if w:
            line_no = int(w.group(1))
            hints.append((idx, OverflowHint(
                overflow_pt=float(w.group(2)),
                line_start=line_no,
                line_end=line_no,
                snippet=w.group(4),
            )))
    hints.sort(key=lambda pair: pair[0])
    return tuple(h for _, h in hints)


# Shim for pdfTeX-only primitives so resumes written for pdflatex (Jake's,
# Awesome-CV, etc.) compile cleanly under Tectonic's XeTeX engine. XeLaTeX
# already produces Unicode-extractable PDFs natively, so the ATS-oriented
# \pdfgentounicode trick is a no-op for our use case — but legacy templates
# still emit the macro and would otherwise crash with "Undefined control
# sequence". Each shim is wrapped in \ifx...\undefined so we never clobber
# a primitive the engine actually defines.
_PDFTEX_SHIM = (
    "\\makeatletter\n"
    "\\ifx\\pdfgentounicode\\undefined\\newcount\\pdfgentounicode\\fi\n"
    "\\ifx\\pdfminorversion\\undefined\\newcount\\pdfminorversion\\fi\n"
    "\\ifx\\pdfobjcompresslevel\\undefined\\newcount\\pdfobjcompresslevel\\fi\n"
    "\\ifx\\pdfcompresslevel\\undefined\\newcount\\pdfcompresslevel\\fi\n"
    "\\ifx\\pdfsuppresswarningpagegroup\\undefined\\newcount\\pdfsuppresswarningpagegroup\\fi\n"
    "\\ifx\\pdfinfo\\undefined\\long\\def\\pdfinfo#1{}\\fi\n"
    "\\ifx\\pdfmapfile\\undefined\\def\\pdfmapfile#1{}\\fi\n"
    "\\makeatother\n"
)

# Files we drop next to doc.tex so \input{<name>} resolves to a no-op stub
# rather than the real pdfTeX-only file shipped with TeX Live.
_INPUT_STUBS: dict[str, str] = {
    "glyphtounicode.tex": "% no-op stub: pdfTeX glyphtounicode is irrelevant under XeLaTeX\n",
}


def _inject_shim(source: str) -> str:
    """Insert the pdfTeX compatibility shim and the wrap-detection shim
    immediately before \\documentclass (or at the start if no
    \\documentclass is present)."""
    combined = _PDFTEX_SHIM + WRAP_SHIM
    match = re.search(r"\\documentclass", source)
    if not match:
        return combined + source
    return source[: match.start()] + combined + source[match.start():]


def compile_latex(source: str, timeout: int = 30) -> CompileResult:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        for name, content in _INPUT_STUBS.items():
            (tmp_path / name).write_text(content)
        tex_file = tmp_path / "doc.tex"
        tex_file.write_text(_inject_shim(source))
        result = subprocess.run(
            ["tectonic", "-X", "compile", "--keep-logs", "--outdir", str(tmp_path), str(tex_file)],
            capture_output=True, text=True, timeout=timeout,
        )
        if result.returncode != 0:
            raise CompileError(result.stderr or result.stdout)
        pdf_path = tmp_path / "doc.pdf"
        if not pdf_path.exists():
            raise CompileError("PDF not produced")
        pdf_bytes = pdf_path.read_bytes()
        page_count = len(PdfReader(io.BytesIO(pdf_bytes)).pages)
        # Tectonic writes a TeX-style .log file next to the output; Overfull
        # \hbox warnings appear there rather than on stdout/stderr.
        log_text = ""
        log_path = tmp_path / "doc.log"
        if log_path.exists():
            log_text = log_path.read_text(errors="replace")
        log_text += "\n" + (result.stdout or "") + "\n" + (result.stderr or "")
        overflows = parse_overflows(log_text)
        return CompileResult(
            pdf=pdf_bytes, page_count=page_count, overflows=overflows
        )
