import io
from pypdf import PdfReader


def extract_pdf_text(data: bytes) -> str:
    """Extract concatenated text from a PDF (one paragraph per page).

    Returns empty string if no extractable text (e.g., image-only PDF)."""
    reader = PdfReader(io.BytesIO(data))
    pages_text: list[str] = []
    for page in reader.pages:
        try:
            t = page.extract_text() or ""
        except Exception:
            t = ""
        t = t.strip()
        if t:
            pages_text.append(t)
    return "\n\n".join(pages_text)
