"""Voyage embedding client wrapper.

The Voyage SDK is sync; we wrap calls in ``asyncio.to_thread`` so callers can
``await`` them. Reads ``VOYAGE_API_KEY`` from the environment lazily, so
importing this module does not require the key to be set.
"""

from __future__ import annotations

import asyncio
import os

import voyageai

_BATCH_SIZE = 128

_client: voyageai.Client | None = None


def _get_client() -> voyageai.Client:
    global _client
    if _client is None:
        _client = voyageai.Client(api_key=os.environ["VOYAGE_API_KEY"])
    return _client


def _voyage_embed_sync(texts: list[str], model: str = "voyage-3") -> list[list[float]]:
    return _get_client().embed(texts, model=model, input_type="document").embeddings


async def _embed_batch(texts: list[str], model: str) -> list[list[float]]:
    """Run a single sync embed call in a thread, retrying once on any error."""
    try:
        return await asyncio.to_thread(_voyage_embed_sync, texts, model)
    except Exception:
        # Single retry — keep minimal per the plan; no tenacity.
        return await asyncio.to_thread(_voyage_embed_sync, texts, model)


async def embed(texts: list[str], model: str = "voyage-3") -> list[list[float]]:
    """Embed a list of documents, batching at 128 inputs per Voyage call."""
    out: list[list[float]] = []
    for i in range(0, len(texts), _BATCH_SIZE):
        batch = texts[i : i + _BATCH_SIZE]
        out.extend(await _embed_batch(batch, model))
    return out


async def embed_query(text: str) -> list[float]:
    """Embed a single query string (uses ``input_type='query'``)."""
    res = await asyncio.to_thread(
        lambda: _get_client().embed([text], model="voyage-3", input_type="query")
    )
    return res.embeddings[0]
