from app.services.compile import compile_latex, CompileError, CompileResult

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
