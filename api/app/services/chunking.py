"""Markdown chunker for KB ingestion.

Strategy:
1. Split the document on ``\n## `` H2 boundaries. Content before the first
   H2 is treated as a preamble chunk with ``heading=None`` (only emitted if
   non-empty after stripping).
2. For each section, if heading + body fits within ``MAX_CHARS``, emit one
   chunk. Otherwise split the body on ``\n\n`` paragraph breaks and group
   paragraphs into ``MAX_CHARS`` windows. When a paragraph itself exceeds the
   window, fall back to fixed-size character windows.
3. Adjacent windows within the same long section overlap by ``OVERLAP``
   characters (byte-based, not word-aware).

Token count is approximated as ``len(text) // 4``.
"""

from __future__ import annotations

from typing import Optional, TypedDict

MAX_CHARS = 800
OVERLAP = 100


class ChunkMeta(TypedDict, total=False):
    heading: Optional[str]


class Chunk(TypedDict):
    text: str
    index: int
    token_count: int
    meta: ChunkMeta


def _approx_tokens(text: str) -> int:
    return len(text) // 4


def _make_chunk(text: str, index: int, heading: Optional[str]) -> Chunk:
    return {
        "text": text,
        "index": index,
        "token_count": _approx_tokens(text),
        "meta": {"heading": heading},
    }


def _split_long_text(text: str) -> list[str]:
    """Split a single string into MAX_CHARS windows with OVERLAP overlap.

    Tries paragraph (\n\n) boundaries first; if a single paragraph is larger
    than the window, falls back to fixed-size character slicing.
    """
    if len(text) <= MAX_CHARS:
        return [text]

    # First try paragraph-grouped windows.
    paragraphs = text.split("\n\n")
    windows: list[str] = []
    current = ""
    for p in paragraphs:
        if len(p) > MAX_CHARS:
            # Flush current first.
            if current:
                windows.append(current)
                current = ""
            # Slice the oversized paragraph itself.
            start = 0
            while start < len(p):
                end = min(start + MAX_CHARS, len(p))
                windows.append(p[start:end])
                if end == len(p):
                    break
                start = end - OVERLAP
            continue
        candidate = (current + "\n\n" + p) if current else p
        if len(candidate) > MAX_CHARS:
            if current:
                windows.append(current)
            current = p
        else:
            current = candidate
    if current:
        windows.append(current)

    # If paragraph-based grouping produced multiple non-overlapping windows,
    # add character-level overlap between consecutive windows so retrieval
    # keeps context across boundaries.
    if len(windows) > 1:
        with_overlap: list[str] = [windows[0]]
        for prev, cur in zip(windows, windows[1:]):
            tail = prev[-OVERLAP:]
            with_overlap.append(tail + cur)
        return with_overlap
    return windows


def chunk_markdown(md: str) -> list[Chunk]:
    """Chunk a markdown document for embedding.

    Returns an empty list for empty input. Otherwise emits chunks with a
    document-global ``index`` (0, 1, 2, ...) and ``meta.heading`` set to the
    H2 text the chunk belongs to (or ``None`` for content before the first
    H2).
    """
    if not md or not md.strip():
        return []

    # Split on H2 boundaries. We use "\n## " so we don't split on ###+ levels
    # or on ## inside code blocks at column>0. The leading "\n" requirement
    # means a top-of-doc "## " heading needs special handling.
    sections: list[tuple[Optional[str], str]] = []
    if md.startswith("## "):
        # Top-of-doc heading: there is no preamble.
        rest = md
    else:
        # Find first "\n## "
        first = md.find("\n## ")
        if first == -1:
            sections.append((None, md))
            rest = ""
        else:
            preamble = md[:first]
            sections.append((None, preamble))
            rest = md[first + 1 :]  # drop leading \n; rest now starts with "## "

    while rest:
        # rest starts with "## "
        nl = rest.find("\n")
        if nl == -1:
            heading = rest[3:].strip()
            body = ""
            rest = ""
        else:
            heading = rest[3:nl].strip()
            after = rest[nl + 1 :]
            nxt = after.find("\n## ")
            if nxt == -1:
                body = after
                rest = ""
            else:
                body = after[:nxt]
                rest = after[nxt + 1 :]
        sections.append((heading, body))

    chunks: list[Chunk] = []
    idx = 0
    for heading, body in sections:
        body_stripped = body.strip()
        if heading is None:
            if not body_stripped:
                continue
            text = body_stripped
        else:
            text = f"## {heading}\n\n{body_stripped}" if body_stripped else f"## {heading}"

        if len(text) <= MAX_CHARS:
            chunks.append(_make_chunk(text, idx, heading))
            idx += 1
            continue

        # Long section: split body, prepend heading line to first chunk only
        # so the heading isn't repeated, but record heading metadata on every
        # chunk. Splitting the full ``text`` keeps overlap semantics simple.
        for piece in _split_long_text(text):
            chunks.append(_make_chunk(piece, idx, heading))
            idx += 1

    return chunks
