import asyncio


def test_embed_returns_one_vector_per_input(monkeypatch):
    from app.services import embeddings

    monkeypatch.setattr(
        embeddings,
        "_voyage_embed_sync",
        lambda texts, model: [[0.1] * 1024 for _ in texts],
    )
    out = asyncio.run(embeddings.embed(["a", "b"]))
    assert len(out) == 2 and len(out[0]) == 1024


def test_embed_chunks_batches_over_128(monkeypatch):
    from app.services import embeddings

    calls = []

    def fake(texts, model):
        calls.append(len(texts))
        return [[0.0] * 1024 for _ in texts]

    monkeypatch.setattr(embeddings, "_voyage_embed_sync", fake)
    asyncio.run(embeddings.embed(["x"] * 200))
    assert calls == [128, 72]
