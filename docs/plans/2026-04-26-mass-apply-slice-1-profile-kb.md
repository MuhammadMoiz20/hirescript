# Mass-Apply Slice 1 — Profile + Knowledge Base Foundation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a structured profile + free-form knowledge base (with embedding-backed retrieval) so future apply-pipeline slices can tailor resumes and fill forms personalised to Moiz.

**Architecture:** Two new domains layered onto the existing FastAPI / async-SQLAlchemy / React app. `Profile` is a single typed row edited via a form. `KB` is `kb_documents` + `kb_chunks` (pgvector) populated by ingest adapters (master LaTeX + manual markdown folder for v1) and queried by top-k cosine similarity. An onboarding chat route uses the existing Claude Agent SDK pattern with tools that write to both stores. No new services, no worker queue — Slice 1 stays inside the existing three-service compose. Worker / Redis / browser arrive in Slice 3+.

**Tech Stack:** FastAPI, async SQLAlchemy 2.x, Alembic, Pydantic v2, pgvector, Voyage embeddings (`voyage-3` via the official `voyageai` SDK), `claude_agent_sdk` (already in use), React + CodeMirror.

**Reference docs (read before starting):**
- `docs/plans/2026-04-26-mass-apply-design.md` — the parent design.
- `CLAUDE.md` — architectural invariants (single-tenant, page_count, etc.).
- `api/app/services/agent.py` — existing Agent SDK pattern. New onboarding chat copies its style, does not refactor it.
- `api/app/models.py` — existing model conventions (`Mapped`, JSONB, single-user FK).

**Scope guardrails:**
- Slice 1 ships nothing job-related. No `jobs`, `applications`, or `tiers` tables.
- No Notion / personal-website / GitHub ingest yet — those are Slice 5. Ingest adapters in Slice 1 are master-LaTeX and a `kb/` markdown folder mounted into the api container.
- No `claude_router` yet (that lands when Max-bound long-running tasks arrive in Slice 3). Slice 1 uses `claude_agent_sdk.query` exactly as `agent.py` does today + an API-key Voyage client for embeddings.
- Tests run inside `docker compose run --rm api pytest`. Postgres (with pgvector) is the test DB — no SQLite fallback for KB tables.

---

## Task 1: Enable pgvector + create profile table

**Files:**
- Create: `api/alembic/versions/<rev>_profile_pgvector.py`
- Test: `api/tests/test_migrations.py` (new)

**Step 1: Write the failing test**

```python
# api/tests/test_migrations.py
import pytest
from sqlalchemy import text
from app.db import engine

@pytest.mark.asyncio
async def test_pgvector_extension_present():
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT extname FROM pg_extension WHERE extname = 'vector'"))
        assert result.scalar() == "vector"

@pytest.mark.asyncio
async def test_profile_table_exists():
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT to_regclass('profile')"))
        assert result.scalar() == "profile"
```

**Step 2: Run** `docker compose run --rm api pytest tests/test_migrations.py -v` → expect FAIL.

**Step 3: Write the migration**

Use `alembic revision -m "profile + pgvector"` then edit the generated file:

```python
def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "profile",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("user.id"), nullable=False, unique=True),
        sa.Column("data", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

def downgrade():
    op.drop_table("profile")
```

`data` is JSONB so the schema can evolve without a migration per field. Strict typing happens in Pydantic.

**Step 4: Run** `docker compose run --rm api alembic upgrade head` then re-run test → expect PASS.

**Step 5: Commit**

```bash
git add api/alembic/versions/ api/tests/test_migrations.py
git commit -m "feat(api): enable pgvector and add profile table"
```

---

## Task 2: Profile Pydantic schema + SQLAlchemy model

**Files:**
- Modify: `api/app/models.py` (append `Profile` model)
- Create: `api/app/schemas/profile.py`
- Test: `api/tests/test_profile_schema.py`

**Step 1: Write the failing test**

```python
# api/tests/test_profile_schema.py
from app.schemas.profile import Profile, WorkAuth, Position
from datetime import date

def test_minimal_profile_validates():
    p = Profile(legal_name="Moiz", email="m@x.com")
    assert p.legal_name == "Moiz"
    assert p.work_auth == WorkAuth()  # default empty
    assert p.positions == []

def test_position_requires_dates_in_order():
    import pytest
    with pytest.raises(ValueError):
        Position(company="X", title="Y", start=date(2024,1,1), end=date(2023,1,1))

def test_dealbreakers_default_empty_list():
    p = Profile(legal_name="Moiz", email="m@x.com")
    assert p.preferences.dealbreakers == []
```

**Step 2: Run** → FAIL (module not found).

**Step 3: Implement the schema**

```python
# api/app/schemas/profile.py
from datetime import date
from typing import Literal, Optional
from pydantic import BaseModel, EmailStr, Field, model_validator

class WorkAuth(BaseModel):
    citizenships: list[str] = []
    sponsorship_needed: dict[str, bool] = {}  # {"US": False, "UK": True}
    relocate_to: list[str] = []  # ["NYC", "Remote-US"]

class Position(BaseModel):
    company: str
    title: str
    start: date
    end: Optional[date] = None
    location: Optional[str] = None
    employment_type: Literal["full_time", "contract", "internship"] = "full_time"
    description: Optional[str] = None  # short blurb; long-form lives in KB

    @model_validator(mode="after")
    def _dates_ordered(self):
        if self.end and self.end < self.start:
            raise ValueError("end before start")
        return self

class Education(BaseModel):
    institution: str
    degree: str
    field: Optional[str] = None
    start: Optional[date] = None
    end: Optional[date] = None

class Preferences(BaseModel):
    salary_floor_usd: Optional[int] = None
    salary_target_usd: Optional[int] = None
    role_families: list[str] = []
    dealbreakers: list[str] = []
    company_stages: list[Literal["pre_seed", "seed", "series_a", "series_b_plus", "public"]] = []
    work_modes: list[Literal["remote", "hybrid", "onsite"]] = []
    cover_letter_default: bool = True
    disclose_salary_default: bool = False

class EEODefaults(BaseModel):
    gender: Optional[str] = None
    race_ethnicity: Optional[str] = None
    veteran: Optional[str] = None
    disability: Optional[str] = None

class Profile(BaseModel):
    legal_name: str
    preferred_name: Optional[str] = None
    email: EmailStr
    phone: Optional[str] = None
    address: Optional[str] = None
    links: dict[str, str] = {}  # {"linkedin": "...", "github": "...", "site": "..."}
    work_auth: WorkAuth = Field(default_factory=WorkAuth)
    positions: list[Position] = []
    education: list[Education] = []
    languages: list[str] = []
    preferences: Preferences = Field(default_factory=Preferences)
    eeo: EEODefaults = Field(default_factory=EEODefaults)
    kill_list: list[str] = []  # company names to never apply to
```

```python
# api/app/models.py — append
class Profile(Base):
    __tablename__ = "profile"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), unique=True)
    data: Mapped[dict] = mapped_column(JSONB, default=dict)
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
```

**Step 4: Run test** → PASS.

**Step 5: Commit**

```bash
git add api/app/schemas/ api/app/models.py api/tests/test_profile_schema.py
git commit -m "feat(api): profile pydantic schema + sqlalchemy model"
```

---

## Task 3: Profile GET/PUT routes

**Files:**
- Create: `api/app/routes/profile.py`
- Modify: `api/app/main.py` (include router)
- Test: `api/tests/test_profile_routes.py`

**Step 1: Failing test**

```python
# api/tests/test_profile_routes.py
def test_get_profile_returns_empty_shell_when_unset(client_authed):
    r = client_authed.get("/profile")
    assert r.status_code == 200
    assert r.json()["legal_name"] == ""  # empty shell, not 404

def test_put_profile_persists(client_authed):
    payload = {"legal_name": "Moiz", "email": "m@x.com", "preferences": {"salary_floor_usd": 200000}}
    r = client_authed.put("/profile", json=payload)
    assert r.status_code == 200
    r2 = client_authed.get("/profile")
    assert r2.json()["legal_name"] == "Moiz"
    assert r2.json()["preferences"]["salary_floor_usd"] == 200000

def test_put_profile_rejects_invalid(client_authed):
    r = client_authed.put("/profile", json={"legal_name": "x", "email": "not-an-email"})
    assert r.status_code == 422
```

**Step 2: Run** → FAIL.

**Step 3: Implement**

```python
# api/app/routes/profile.py
from fastapi import APIRouter, Depends
from sqlalchemy import select
from app.auth import require_user
from app.db import get_db
from app.models import Profile as ProfileModel
from app.schemas.profile import Profile

router = APIRouter(prefix="/profile", tags=["profile"])

EMPTY_SHELL = {"legal_name": "", "email": "unset@example.com"}

@router.get("", response_model=Profile)
async def get_profile(user_id=Depends(require_user), db=Depends(get_db)):
    row = (await db.execute(select(ProfileModel).where(ProfileModel.user_id == user_id))).scalar_one_or_none()
    if row is None:
        return Profile.model_validate(EMPTY_SHELL)
    return Profile.model_validate(row.data)

@router.put("", response_model=Profile)
async def put_profile(payload: Profile, user_id=Depends(require_user), db=Depends(get_db)):
    row = (await db.execute(select(ProfileModel).where(ProfileModel.user_id == user_id))).scalar_one_or_none()
    if row is None:
        row = ProfileModel(user_id=user_id, data=payload.model_dump(mode="json"))
        db.add(row)
    else:
        row.data = payload.model_dump(mode="json")
    await db.commit()
    return payload
```

Wire router in `api/app/main.py` next to the others.

**Step 4: Run** → PASS.

**Step 5: Commit**

```bash
git add api/app/routes/profile.py api/app/main.py api/tests/test_profile_routes.py
git commit -m "feat(api): profile get/put routes"
```

---

## Task 4: KB tables (`kb_documents`, `kb_chunks`)

**Files:**
- Create: `api/alembic/versions/<rev>_kb_tables.py`
- Modify: `api/app/models.py`
- Test: `api/tests/test_migrations.py` (extend)

**Schema:**
- `kb_documents`: `id, user_id, source, source_id, title, raw_text, metadata jsonb, fetched_at, hash`. `(user_id, source, source_id)` unique.
- `kb_chunks`: `id, document_id, chunk_index, text, token_count, embedding vector(1024), metadata jsonb`. Index: HNSW on `embedding` with `vector_cosine_ops`.

**Step 1: Test**

```python
@pytest.mark.asyncio
async def test_kb_tables_exist():
    async with engine.connect() as conn:
        for t in ("kb_documents", "kb_chunks"):
            assert (await conn.execute(text(f"SELECT to_regclass('{t}')"))).scalar() == t

@pytest.mark.asyncio
async def test_kb_chunks_has_vector_index():
    async with engine.connect() as conn:
        rows = (await conn.execute(text("SELECT indexname FROM pg_indexes WHERE tablename='kb_chunks'"))).all()
        assert any("embedding" in r[0] for r in rows)
```

**Step 2-4:** Migration uses `pgvector.sqlalchemy.Vector(1024)` (Voyage `voyage-3` is 1024-d). Add HNSW index in the migration:

```python
op.execute("CREATE INDEX kb_chunks_embedding_idx ON kb_chunks USING hnsw (embedding vector_cosine_ops)")
```

Models follow the same `Mapped` pattern. `KbDocument.metadata` must be named `meta` on the Python side — `metadata` collides with SQLAlchemy's reserved attribute.

**Step 5: Commit**

```bash
git commit -m "feat(api): kb_documents + kb_chunks tables with pgvector"
```

---

## Task 5: Voyage embedding client wrapper

**Files:**
- Create: `api/app/services/embeddings.py`
- Test: `api/tests/test_embeddings.py`

The Voyage SDK is sync; wrap calls in `asyncio.to_thread`. Read `VOYAGE_API_KEY` from env. Batch size 128, retry once on 5xx.

**Step 1: Test (uses a fake)**

```python
def test_embed_returns_one_vector_per_input(monkeypatch):
    from app.services import embeddings
    monkeypatch.setattr(embeddings, "_voyage_embed_sync", lambda texts, model: [[0.1]*1024 for _ in texts])
    out = asyncio.run(embeddings.embed(["a", "b"]))
    assert len(out) == 2 and len(out[0]) == 1024

def test_embed_chunks_batches_over_128(monkeypatch):
    calls = []
    def fake(texts, model): calls.append(len(texts)); return [[0.0]*1024 for _ in texts]
    monkeypatch.setattr(embeddings, "_voyage_embed_sync", fake)
    asyncio.run(embeddings.embed(["x"] * 200))
    assert calls == [128, 72]
```

**Step 3: Implementation sketch**

```python
# api/app/services/embeddings.py
import asyncio, os
import voyageai

_client = None
def _get_client():
    global _client
    if _client is None: _client = voyageai.Client(api_key=os.environ["VOYAGE_API_KEY"])
    return _client

def _voyage_embed_sync(texts: list[str], model: str = "voyage-3") -> list[list[float]]:
    return _get_client().embed(texts, model=model, input_type="document").embeddings

async def embed(texts: list[str], model: str = "voyage-3") -> list[list[float]]:
    out: list[list[float]] = []
    for i in range(0, len(texts), 128):
        batch = texts[i:i+128]
        out.extend(await asyncio.to_thread(_voyage_embed_sync, batch, model))
    return out

async def embed_query(text: str) -> list[float]:
    # use input_type="query" for retrieval-side
    res = await asyncio.to_thread(lambda: _get_client().embed([text], model="voyage-3", input_type="query"))
    return res.embeddings[0]
```

Add `voyageai` to `api/requirements.txt`. Add `VOYAGE_API_KEY` to `docker-compose.yml` api service env.

**Step 5: Commit** `feat(api): voyage embedding client`

---

## Task 6: Markdown chunking utility

**Files:**
- Create: `api/app/services/chunking.py`
- Test: `api/tests/test_chunking.py`

Simple recursive splitter: split on `\n## `, then `\n\n`, then 800-char windows with 100-char overlap. Token count via `tiktoken` or character-approximation (chars / 4). Return `[{"text": str, "index": int, "meta": {"heading": str | None}}]`.

**Test cases:** empty input → `[]`; short doc → 1 chunk; doc with three `##` sections → 3 chunks with heading metadata; doc longer than 800 chars in one section → multiple chunks with overlap.

Commit: `feat(api): markdown chunker for kb ingestion`

---

## Task 7: KB ingest service + master-LaTeX adapter

**Files:**
- Create: `api/app/services/kb_ingest.py`
- Create: `api/app/services/kb_sources/latex_master.py`
- Test: `api/tests/test_kb_ingest_latex.py`

`kb_ingest.ingest_document(source, source_id, title, raw_text, meta) -> KbDocument`:
1. Hash `raw_text`. If `(user_id, source, source_id)` exists with same hash → no-op return existing.
2. Otherwise upsert document, delete old chunks, chunk, embed all chunks in one batch, insert chunks with embeddings.

`latex_master.ingest()` reads the master Resume row (existing `Resume` model where `parent_id IS NULL`), strips LaTeX commands to plain text (use `pylatexenc.latex2text`), calls `ingest_document(source="latex_master", source_id="1", title="Master Resume", raw_text=...)`.

**Test (with mocked `embed`):**

```python
async def test_latex_master_ingest_creates_document_and_chunks(db, monkeypatch):
    monkeypatch.setattr("app.services.embeddings.embed", lambda texts: [[0.0]*1024]*len(texts))
    # seed a Resume row with some \section{Experience} content
    ...
    from app.services.kb_sources.latex_master import ingest
    await ingest(user_id=1, db=db)
    docs = (await db.execute(select(KbDocument))).scalars().all()
    assert len(docs) == 1 and docs[0].source == "latex_master"
    chunks = (await db.execute(select(KbChunk))).scalars().all()
    assert len(chunks) >= 1

async def test_re_ingest_with_same_content_is_noop(db, monkeypatch):
    # ingest twice, assert chunk count unchanged and embed was called once
    ...
```

Add `pylatexenc` to requirements.

Commit: `feat(api): kb ingest with master-latex adapter`

---

## Task 8: Manual markdown folder adapter

**Files:**
- Create: `api/app/services/kb_sources/markdown_folder.py`
- Modify: `docker-compose.yml` (mount `./kb` into api at `/app/kb`)
- Test: `api/tests/test_kb_ingest_markdown.py`

`markdown_folder.ingest(root="/app/kb")` walks `*.md` files. Each file → `ingest_document(source="markdown", source_id=relative_path, title=first H1 or filename, raw_text=file content, meta={"path": ...})`. Files removed from disk → corresponding documents (and chunks) deleted.

Tests: tmp_path fixture, write 2 .md files, ingest, assert 2 docs. Modify one, re-ingest, assert that doc's chunks rebuilt and the other's untouched. Delete one, re-ingest, assert deletion cascades.

Commit: `feat(api): markdown folder kb adapter`

---

## Task 9: KB retrieval

**Files:**
- Modify: `api/app/services/kb_ingest.py` (add `retrieve`)
- Test: `api/tests/test_kb_retrieve.py`

```python
async def retrieve(user_id: int, query: str, k: int = 8, source_filter: list[str] | None = None) -> list[Chunk]:
    qvec = await embeddings.embed_query(query)
    stmt = (
        select(KbChunk, KbDocument)
        .join(KbDocument, KbChunk.document_id == KbDocument.id)
        .where(KbDocument.user_id == user_id)
    )
    if source_filter:
        stmt = stmt.where(KbDocument.source.in_(source_filter))
    stmt = stmt.order_by(KbChunk.embedding.cosine_distance(qvec)).limit(k)
    rows = (await db.execute(stmt)).all()
    return [Chunk(text=c.text, source=d.source, title=d.title, distance=...) for c, d in rows]
```

**Test:** seed 3 documents with distinct content, embed with a deterministic fake (e.g. `sum(ord(c)) → vector`), retrieve with a query closest to one specific doc, assert that doc is rank 1.

Commit: `feat(api): kb retrieval by cosine similarity`

---

## Task 10: KB sources + sync status routes

**Files:**
- Create: `api/app/routes/kb.py`
- Test: `api/tests/test_kb_routes.py`

Endpoints:
- `GET /kb/sources` → list of `{source, document_count, chunk_count, last_synced_at}` aggregated from `kb_documents`.
- `POST /kb/sources/{source}/sync` → kicks off `latex_master.ingest()` or `markdown_folder.ingest()` synchronously (Slice 1: blocking; the worker queue lands in Slice 3). Returns counts.
- `GET /kb/documents?source=X` → paginated list for the UI.
- `DELETE /kb/documents/{id}` → manual removal.

Tests cover happy path + auth gate (`require_user`).

Commit: `feat(api): kb sources/documents api`

---

## Task 11: Profile editor UI

**Files:**
- Create: `web/src/routes/Profile.tsx`
- Modify: `web/src/api.ts` (add `getProfile`, `putProfile`)
- Modify: `web/src/App.tsx` (add a route or view-state branch for profile)
- Test: `web/src/routes/Profile.test.tsx`

Form is structured but pragmatic: scalars as inputs, lists (positions, education, dealbreakers, etc.) as add/remove rows. Use plain React state — no form library. Save button calls `putProfile`; relies on Pydantic 422 from the server for validation feedback.

**Test (Vitest + Testing Library):**
- Renders existing profile values in the form.
- Editing a field and clicking Save calls `putProfile` with the new payload.
- Server 422 with field error renders an inline error.

Commit: `feat(web): profile editor`

---

## Task 12: KB sources panel UI

**Files:**
- Create: `web/src/routes/Knowledge.tsx`, `web/src/components/KbSourceCard.tsx`
- Modify: `web/src/api.ts`
- Modify: `web/src/App.tsx`

Three sections: source cards (name, last sync, doc/chunk count, "Sync now" button), document list (title, source, fetched_at, "Delete" button), markdown-folder helper text ("drop .md files into the `kb/` folder, then click Sync").

Tests: Source card renders counts; clicking "Sync" calls `POST /kb/sources/{source}/sync` and refreshes counts; delete flow.

Commit: `feat(web): kb sources + documents panel`

---

## Task 13: Onboarding chat — backend

**Files:**
- Create: `api/app/services/onboarding.py`
- Create: `api/app/routes/onboarding.py`
- Test: `api/tests/test_onboarding.py`

The onboarding agent has three tools (Agent SDK tool definitions):
1. `read_profile()` → returns current profile JSON.
2. `update_profile_fields(patch: dict)` → deep-merges `patch` into profile, validates with Pydantic, persists.
3. `add_kb_note(title: str, body: str)` → ingests a markdown note as `source="onboarding"`, `source_id=uuid()`, embeds, stores.

System prompt: "You are interviewing Moiz to populate his job-application profile. Read the profile, identify gaps and ambiguities, ask one question at a time. When he answers, call `update_profile_fields` for structured facts and `add_kb_note` for narrative answers worth indexing for future tailoring. Never invent values."

Endpoint: `POST /onboarding/message {message: str, history: list}` → SSE stream of tokens, mirroring the pattern in `routes/resumes.py`'s edit endpoint.

**Tests (with `claude_agent_sdk.query` mocked to a scripted async iterator):**
- Sending a message persists user + assistant turns and returns the streamed text.
- A scripted assistant turn that "calls" `update_profile_fields` results in the profile row being updated.
- A scripted assistant turn that "calls" `add_kb_note` results in a new `kb_documents` row with `source="onboarding"`.

Commit: `feat(api): onboarding interview agent + tools`

---

## Task 14: Onboarding chat — UI

**Files:**
- Create: `web/src/routes/Onboarding.tsx`
- Modify: `web/src/api.ts` (add `streamOnboarding` mirroring `streamEdit`)
- Modify: `web/src/App.tsx`

Simple chat: history list, input box, streamed assistant reply. After each turn, refresh profile + KB counts in the background so the user sees the agent's writes land.

Tests: render a scripted history; sending a message appends user turn and renders streamed assistant tokens; on completion, calls `getProfile` to refresh.

Commit: `feat(web): onboarding interview ui`

---

## Task 15: End-to-end smoke test

**Files:**
- Create: `web/e2e/onboarding-and-kb.spec.ts`

Playwright flow:
1. Log in.
2. Open Profile, fill name + email, save, reload, assert persisted.
3. Open Knowledge, click "Sync" on the master-latex source, assert chunk count > 0.
4. Drop a fixture `.md` into the mounted `kb/` folder, sync markdown, assert it appears.
5. Open Onboarding, send a message, assert a streamed reply renders.

Anthropic and Voyage are real here — gate this spec behind `if (!process.env.LIVE_E2E) test.skip()` so CI doesn't burn credits.

Commit: `test(e2e): onboarding + kb smoke flow`

---

## Done criteria for Slice 1

- A fresh `docker compose up --build && alembic upgrade head` produces a working app with profile and KB tabs.
- `pytest` passes inside the api container.
- `vitest` passes inside the web container.
- Manually: a profile can be filled in, `kb/notes.md` dropped in, master LaTeX synced, and a query through the onboarding chat retrieves relevant chunks (verified by an internal log line in `retrieve`).
- No code referring to jobs, applications, tiers, browsers, or queues exists yet — those are later slices.

## Open items deferred from the design doc

- **Notion + personal-website ingest** → Slice 5.
- **Browser-agent harness choice** → Slice 5 prep.
- **Worker queue choice (Arq vs. Celery)** → Slice 3 (when source pollers + apply pipeline arrive).
- **Notification channel (Pushover vs. ntfy)** → Slice 3 (when captcha-pause exists).
- **`claude_router` Max-vs-API-key dispatch** → Slice 3 (when long-running Max-bound tasks arrive). Slice 1 uses the existing Agent SDK pattern + API-key Voyage.
