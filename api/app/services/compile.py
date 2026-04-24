import io
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from pypdf import PdfReader

class CompileError(RuntimeError):
    def __init__(self, stderr: str):
        super().__init__(stderr)
        self.stderr = stderr

@dataclass(frozen=True)
class CompileResult:
    pdf: bytes
    page_count: int

def compile_latex(source: str, timeout: int = 30) -> CompileResult:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        tex_file = tmp_path / "doc.tex"
        tex_file.write_text(source)
        result = subprocess.run(
            ["tectonic", "-X", "compile", "--outdir", str(tmp_path), str(tex_file)],
            capture_output=True, text=True, timeout=timeout,
        )
        if result.returncode != 0:
            raise CompileError(result.stderr or result.stdout)
        pdf_path = tmp_path / "doc.pdf"
        if not pdf_path.exists():
            raise CompileError("PDF not produced")
        pdf_bytes = pdf_path.read_bytes()
        page_count = len(PdfReader(io.BytesIO(pdf_bytes)).pages)
        return CompileResult(pdf=pdf_bytes, page_count=page_count)
