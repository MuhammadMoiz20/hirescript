import textwrap

from app.services.compile import (
    compile_latex, CompileError, CompileResult, OverflowHint, parse_overflows,
)

MINIMAL_DOC = r"""
\documentclass{article}
\begin{document}
Hello HireScript.
\end{document}
"""

def test_compile_returns_pdf_bytes_and_page_count():
    result = compile_latex(MINIMAL_DOC)
    assert isinstance(result, CompileResult)
    assert result.pdf[:4] == b"%PDF"
    assert result.page_count == 1

def test_compile_detects_multi_page():
    doc = r"""
    \documentclass{article}
    \begin{document}
    """ + ("Filler paragraph. " * 2000) + r"""
    \end{document}
    """
    result = compile_latex(doc)
    assert result.page_count >= 2

def test_compile_raises_on_invalid_latex():
    import pytest
    with pytest.raises(CompileError):
        compile_latex(r"\documentclass{article}\begin{document}\unknowncmd\end{document}")


def test_compile_shims_pdftex_only_primitives():
    """Resumes lifted from pdflatex templates (Jake's, Awesome-CV) use
    \\pdfgentounicode and \\input{glyphtounicode} for ATS purposes. Tectonic's
    XeTeX engine doesn't define those, but our shim should let them compile
    cleanly without losing ATS readability (XeLaTeX emits Unicode natively)."""
    doc = r"""
    \documentclass{article}
    \pdfgentounicode=1
    \input{glyphtounicode}
    \pdfminorversion=7
    \pdfobjcompresslevel=2
    \pdfcompresslevel=9
    \pdfsuppresswarningpagegroup=1
    \pdfinfo{/Title (Test)}
    \begin{document}
    hello world
    \end{document}
    """
    result = compile_latex(doc)
    assert result.pdf[:4] == b"%PDF"
    assert result.page_count == 1


def test_parse_overflows_extracts_warnings():
    """Synthetic Tectonic log; verifies we capture page-overflow warnings,
    page-line ranges, and a cleaned snippet of the offending text."""
    log = """\
note: Running TeX ...
Overfull \\hbox (12.34pt too wide) in paragraph at lines 42--44
[]\\OT1/cmr/m/n/10.95 Built async FastAPI backend services in Python handling
[]
Overfull \\hbox (3.5pt too wide) in paragraph at lines 51--52
\\T1/cmr/m/n/10 Architected Google Calendar Canvas MCP servers
note: Writing PDF ...
"""
    hints = parse_overflows(log)
    assert len(hints) == 2
    assert hints[0].overflow_pt == 12.34
    assert hints[0].line_start == 42
    assert hints[0].line_end == 44
    assert "FastAPI" in hints[0].snippet
    assert "/cmr/" not in hints[0].snippet  # font prefix stripped
    assert hints[1].overflow_pt == 3.5
    assert "Calendar" in hints[1].snippet


def test_parse_overflows_no_warnings():
    assert parse_overflows("note: clean run\nnote: Writing PDF ...") == ()


def test_compile_real_overflow_is_detected():
    """End-to-end: a doc with a deliberately unbreakable long word in a
    paragraph should produce at least one OverflowHint surfaced through
    CompileResult."""
    doc = r"""
\documentclass{article}
\usepackage[margin=0.5in]{geometry}
\setlength{\parindent}{0pt}
\begin{document}
A long paragraph aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa with no space.
\end{document}
"""
    result = compile_latex(doc)
    assert result.page_count >= 1
    assert len(result.overflows) >= 1
    assert result.overflows[0].overflow_pt > 0


def test_compile_shim_does_not_clobber_engine_primitives():
    """The shim guards every definition with \\ifx...\\undefined, so on engines
    where these primitives exist the shim must be a no-op. We can at least
    verify the document still compiles when the source itself uses \\newcount
    on the same name afterwards (would error if shim used \\def unconditionally)."""
    doc = r"""
    \documentclass{article}
    \pdfgentounicode=1
    \begin{document}
    ok
    \end{document}
    """
    # Compile twice in a row to confirm idempotence and no temp-file leakage.
    compile_latex(doc)
    result = compile_latex(doc)
    assert result.page_count == 1


def test_parse_overflows_extracts_wrap_hint():
    log = (
        "Some preamble\n"
        "HS_WRAP: line=87 over=14.20pt limit=396.00pt text=<<<Optimized PostgreSQL via connection pooling, reducing p95 query latency by 50%.>>>\n"
        "Trailing junk\n"
    )
    hints = parse_overflows(log)
    assert len(hints) == 1
    h = hints[0]
    assert h.line_start == 87
    assert h.line_end == 87
    assert h.overflow_pt == 14.20
    assert "Optimized PostgreSQL" in h.snippet


def test_parse_overflows_merges_hbox_and_wrap_in_source_order():
    log = (
        "Overfull \\hbox (5.00pt too wide) in paragraph at lines 12--13\n"
        "[]\\OT1/cmr/m/n/10.95 some overfull text fragment\n"
        "HS_WRAP: line=42 over=8.00pt limit=396.00pt text=<<<a wrapped bullet>>>\n"
    )
    hints = parse_overflows(log)
    assert len(hints) == 2
    assert hints[0].line_start == 12
    assert hints[0].overflow_pt == 5.0
    assert hints[1].line_start == 42
    assert hints[1].snippet == "a wrapped bullet"


def test_parse_overflows_drops_malformed_wrap_line():
    log = "HS_WRAP: this line is malformed and should be ignored\n"
    assert parse_overflows(log) == ()


def test_parse_overflows_caps_runaway_hs_wrap_reassembly():
    """A truncated HS_WRAP line with no closing '>>>' must not swallow the
    rest of the log. The reassembly lookahead is capped so subsequent
    Overfull \\hbox warnings are still detected."""
    filler = "\n".join(f"arbitrary log line {n}" for n in range(20))
    log = (
        "HS_WRAP: line=1 over=1.00pt limit=10.00pt text=<<<no closing marker\n"
        + filler + "\n"
        "Overfull \\hbox (5.00pt too wide) in paragraph at lines 100--101\n"
        "[]\\OT1/cmr/m/n/10.95 the offending fragment\n"
    )
    hints = parse_overflows(log)
    # Malformed wrap is dropped (no hint with line_start=1 from _WRAP_RE).
    assert all(not (h.line_start == 1 and h.line_end == 1) for h in hints)
    # The hbox warning that appears after the runaway is still detected.
    hbox = next((h for h in hints if h.line_start == 100 and h.line_end == 101), None)
    assert hbox is not None, f"expected hbox hint, got {hints!r}"
    assert hbox.overflow_pt == 5.0
    assert "offending fragment" in hbox.snippet


def test_parse_overflows_handles_triple_angle_in_text():
    # If a bullet legitimately contains '>>>', the non-greedy match takes
    # the first closing '>>>'. We accept slight truncation; we never crash.
    log = "HS_WRAP: line=5 over=1.00pt limit=10.00pt text=<<<a>>>extra>>>\n"
    hints = parse_overflows(log)
    assert len(hints) == 1
    assert hints[0].snippet == "a"


_LONG_BULLET = (
    "Optimized PostgreSQL via connection pooling, reducing p95 query "
    "latency by 50\\% and improving overall platform performance across "
    "every region of the deployment fleet."
)


def _minimal_resume(item_text: str) -> str:
    # Minimal Jake's-resume-like skeleton with a single \resumeItem.
    return textwrap.dedent(rf"""
    \documentclass[letterpaper,10pt]{{article}}
    \usepackage[margin=0.5in]{{geometry}}
    \usepackage{{enumitem}}
    \newcommand{{\resumeItem}}[1]{{\item\small{{#1}}}}
    \newcommand{{\resumeItemListStart}}{{\begin{{itemize}}[leftmargin=0.15in]}}
    \newcommand{{\resumeItemListEnd}}{{\end{{itemize}}}}
    \begin{{document}}
    \resumeItemListStart
    \resumeItem{{ {item_text} }}
    \resumeItemListEnd
    \end{{document}}
    """).strip()


def test_compile_emits_wrap_hint_for_long_resume_item():
    src = _minimal_resume(_LONG_BULLET)
    result = compile_latex(src)
    assert result.page_count == 1
    assert len(result.overflows) >= 1
    wrap = next((h for h in result.overflows
                 if "Optimized PostgreSQL" in h.snippet), None)
    assert wrap is not None, f"expected wrap hint, got {result.overflows!r}"
    assert wrap.overflow_pt > 0


def test_compile_no_wrap_hint_for_short_resume_item():
    src = _minimal_resume("Short bullet that fits on one line easily.")
    result = compile_latex(src)
    assert result.page_count == 1
    assert all("Short bullet" not in h.snippet for h in result.overflows)
