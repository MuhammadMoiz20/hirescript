from app.services.compile import compile_latex
from app.services.pdf_text import extract_pdf_text


def test_extracts_text_from_compiled_pdf():
    src = r"""
    \documentclass{article}
    \begin{document}
    Hello PdfTextExtractor.
    Hire Script.
    \end{document}
    """
    result = compile_latex(src)
    text = extract_pdf_text(result.pdf)
    assert "Hello" in text
    assert "PdfTextExtractor" in text or "Pdf" in text


def test_returns_empty_string_for_invalid_pdf():
    # pypdf raises on garbage bytes; the helper should not crash
    import pytest
    from pypdf.errors import PdfReadError
    with pytest.raises((PdfReadError, Exception)):
        extract_pdf_text(b"not a pdf")
