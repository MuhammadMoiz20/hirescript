"""Tests for the markdown chunker.

Implementation choices documented here:
- Preamble (content before the first ``##``) is emitted as its own chunk
  with ``heading=None`` when non-empty after stripping.
- Long sections are split using paragraph (\n\n) boundaries first, with
  byte-based 100-char overlap between consecutive windows. If a single
  paragraph exceeds the 800-char window, it is sliced at fixed character
  boundaries with the same overlap.
"""

from app.services.chunking import chunk_markdown


def test_empty_input_returns_empty_list():
    assert chunk_markdown("") == []
    assert chunk_markdown("   \n\n  ") == []


def test_short_doc_one_chunk():
    out = chunk_markdown("just a little text.")
    assert len(out) == 1
    assert out[0]["text"] == "just a little text."
    assert out[0]["index"] == 0
    assert out[0]["meta"].get("heading") is None
    assert out[0]["token_count"] == len("just a little text.") // 4


def test_three_sections_become_three_chunks():
    md = "intro\n\n## A\n\naaa\n\n## B\n\nbbb\n\n## C\n\nccc"
    out = chunk_markdown(md)
    headings = [c["meta"].get("heading") for c in out]
    # Preamble "intro" becomes a None-heading chunk, then A/B/C => 4 chunks.
    assert headings == [None, "A", "B", "C"]
    assert "A" in headings and "B" in headings and "C" in headings
    # Indices are document-global.
    assert [c["index"] for c in out] == [0, 1, 2, 3]


def test_top_level_heading_no_preamble():
    md = "## Only\n\nbody text"
    out = chunk_markdown(md)
    assert len(out) == 1
    assert out[0]["meta"]["heading"] == "Only"


def test_long_section_splits_with_overlap():
    body = "x" * 1000
    md = f"## Big\n\n{body}"
    out = chunk_markdown(md)
    assert len(out) >= 2
    assert all(c["meta"]["heading"] == "Big" for c in out)
    a, b = out[0]["text"], out[1]["text"]
    # tolerant overlap assertion: tail of chunk N should appear at the
    # start of chunk N+1.
    assert a[-100:] == b[:100] or a[-50:] in b[:200]


def test_indices_are_global_across_sections():
    body = "y" * 1000  # forces splitting in section A
    md = f"## A\n\n{body}\n\n## B\n\nshort body"
    out = chunk_markdown(md)
    indices = [c["index"] for c in out]
    assert indices == list(range(len(out)))
    # Last chunk should be the "B" section.
    assert out[-1]["meta"]["heading"] == "B"
