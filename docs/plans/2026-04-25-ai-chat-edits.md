# Phase 1 — AI Chat Edits + OnePageEnforcer

> **For Claude:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`.

**Goal:** Add AI-driven LaTeX editing through a chat sidebar with accept/reject diff flow and the one-page enforcement loop. Free-form chat edits use Haiku 4.5; the overflow-repair loop escalates to Sonnet 4.6 at iteration 3+.

**Anchor docs:**
- `docs/plans/2026-04-24-resume-maker-design.md` — esp. "The One-Page Constraint", "Realtime & Token Economics", "AI Integration"
- `CLAUDE.md` — "Non-Negotiable Resume Rule"

**Scope:**
- Free-form chat edit (single endpoint + sidebar UI). No "Tailor to JD" yet (Phase 2).
- `OnePageEnforcer` repair loop (≤4 iterations, escalates Haiku→Sonnet).
- Protected-terms list (base verbs ∪ user-pinned).
- Streaming diff to UI.
- Accept/reject with mandatory page-count check.
- Tests use SDK mocks; one live smoke test guarded by env flag.

**Out of scope:** Tailoring to JD, variants, section form editor, version history, MinIO, deployment.

---

## Task 1: Install claude-agent-sdk + Claude CLI in api image

**Files:**
- Modify: `api/Dockerfile` (install Node 20 + `@anthropic-ai/claude-code` CLI; mount user `.claude` at runtime)
- Modify: `api/pyproject.toml` (add `claude-agent-sdk==0.1.*` to deps)
- Modify: `docker-compose.yml` (mount `~/.claude` from host into api container at `/root/.claude`)
- Create: `api/tests/test_agent_smoke.py` (skipped unless `RUN_AGENT_SMOKE=1`)

**Step 1: Update `api/Dockerfile`** — after existing Tectonic block, add:

```dockerfile
# Node + Claude CLI for claude-agent-sdk
RUN apt-get update && apt-get install -y --no-install-recommends curl \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && npm install -g @anthropic-ai/claude-code \
 && apt-get remove -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
```

**Step 2: Add `claude-agent-sdk==0.1.*` to api/pyproject.toml main deps.**

**Step 3: docker-compose.yml** — add to `api.volumes`:

```yaml
- ${HOME}/.claude:/root/.claude
```

**Step 4: smoke test** in `api/tests/test_agent_smoke.py`:

```python
import os
import pytest
from claude_agent_sdk import query

@pytest.mark.skipif(os.environ.get("RUN_AGENT_SMOKE") != "1", reason="needs live claude")
async def test_agent_smoke_says_hello():
    chunks = []
    async for msg in query(prompt="Reply with the single word: pong", options={"system_prompt": "You are a test."}):
        chunks.append(msg)
    assert chunks
```

**Step 5: Verify build + non-smoke suite still passes.**

```bash
docker compose build api
docker compose run --rm api pytest -v
```

**Commit:** `feat(api): install claude-agent-sdk and claude CLI in api image`

---

## Task 2: Agent service wrapper (model routing + caching + streaming)

**Files:**
- Create: `api/app/services/agent.py`
- Create: `api/tests/test_agent_service.py`

The wrapper is the only place SDK calls happen. It enforces:
- Model routing (Haiku 4.5 / Sonnet 4.6 / Opus 4.7).
- Prompt caching with `cache_control: ephemeral` on system prompt + protected-terms + master LaTeX prefixes.
- Streaming.
- Strict JSON envelope for repair-loop responses: `{"diff": str, "removed_terms": [str], "rationale": str}`.

**Public API:**

```python
from typing import AsyncIterator, Literal

ModelTier = Literal["haiku", "sonnet", "opus"]

async def edit_resume(
    *,
    current_latex: str,
    instruction: str,
    protected_terms: list[str],
    page_count_hint: int,
    tier: ModelTier = "haiku",
) -> AsyncIterator[str]:
    """Stream a unified diff for the requested edit."""

async def repair_overflow(
    *,
    current_latex: str,
    last_diff: str,
    page_count: int,
    protected_terms: list[str],
    tier: ModelTier,
) -> dict:
    """One repair iteration. Returns {'diff', 'removed_terms', 'rationale'}."""
```

**Step 1: failing test** in `api/tests/test_agent_service.py` mocks `claude_agent_sdk.query` and asserts the wrapper composes the system prompt correctly (one-page rule, protected terms, JSON-envelope instruction in repair_overflow), routes by tier, and surfaces stream chunks.

**Step 2: implement** `api/app/services/agent.py`. Use `claude_agent_sdk.query(prompt, options)` and pass model identifier per tier.

**Step 3: run** `docker compose run --rm api pytest tests/test_agent_service.py -v`. Expect PASS.

**Commit:** `feat(api): agent service wrapper with model routing and caching`

---

## Task 3: Protected terms module + DB column

**Files:**
- Create: `api/app/services/protected_terms.py`
- Modify: `api/app/models.py` (add `protected_terms` jsonb on `resumes`, default `[]`)
- Create: `api/alembic/versions/0002_resume_protected_terms.py`
- Create: `api/tests/test_protected_terms.py`

**Base list (verbatim):**

```python
BASE_PROTECTED_VERBS = [
    "led","architected","shipped","reduced","migrated","owned","automated",
    "scaled","implemented","designed","negotiated","drove","launched",
    "optimized","integrated","built","engineered","developed","authored",
    "delivered","standardized","cut","translated","refactored","pioneered",
]
```

**Public API:**

```python
def resolve_protected_terms(*, user_pinned: list[str], jd_terms: list[str] | None = None) -> list[str]:
    """Return BASE ∪ jd_terms ∪ user_pinned, dedup'd, lowercased."""
```

**Step 1: failing tests** for dedup/case + presence of base verbs.

**Step 2: implement.**

**Step 3: model + migration** for `resumes.protected_terms` (jsonb default `'[]'::jsonb`).

**Step 4: run** model and protected-terms tests.

**Commit:** `feat(api): protected terms module and resume column`

---

## Task 4: OnePageEnforcer service

**Files:**
- Create: `api/app/services/enforcer.py`
- Create: `api/tests/test_enforcer.py`

**Behavior:**
- Input: candidate LaTeX, protected terms, max iterations (config, default 4), starting tier (Haiku).
- For each iteration:
  - Compile via `compile_latex`.
  - If `page_count == 1`: return `EnforceResult(latex, pdf, page_count=1, iterations, tier_history)`.
  - If iter ≥ 2 and current tier is Haiku: escalate to Sonnet for next call.
  - Call `repair_overflow` with `OverflowContext` (page_count, protected_terms, last diff).
  - Apply returned diff to current LaTeX.
- If exhausted: return best attempt with `enforced=False`.
- Reject if any protected term was removed: rerun with explicit "must preserve X".

**Public API:**

```python
@dataclass(frozen=True)
class EnforceResult:
    latex: str
    pdf: bytes
    page_count: int
    iterations: int
    enforced: bool          # True iff page_count == 1
    tier_history: list[str]
    log: list[str]

async def enforce_one_page(
    *, candidate_latex: str, protected_terms: list[str], max_iterations: int = 4
) -> EnforceResult:
    ...
```

**Step 1: failing tests** mock `repair_overflow` to return progressively shorter diffs; assert convergence, escalation, protected-term enforcement, exhaustion path.

**Step 2: implement.** Use `subprocess`-safe `compile_latex` from `app.services.compile`.

**Commit:** `feat(api): OnePageEnforcer repair loop`

---

## Task 5: Edit endpoints (propose + accept)

**Files:**
- Modify: `api/app/routes/resumes.py`
- Modify: `api/app/schemas.py`
- Create: `api/tests/test_resume_edits.py`

**New endpoints:**

- `POST /resumes/{id}/edits` — body: `{instruction: str, tier?: "haiku"|"sonnet"|"opus"}`. Streams Server-Sent Events: `chunk` events with diff tokens, then a final `result` event with `{proposed_latex, page_count, enforced, iterations, removed_terms}`. Diff and PDF are computed via `OnePageEnforcer.enforce_one_page` after the model finishes streaming.
- `POST /resumes/{id}/edits/accept` — body: `{proposed_latex: str}`. Re-compiles to verify `page_count == 1`. If yes, persists `latex_source = proposed_latex`. Returns the new `ResumeOut` plus PDF bytes via `X-Page-Count`. Reject with 422 if page_count != 1.

**Step 1: failing tests** mock the agent service. Cover: streaming response shape, accept happy path, accept rejects multi-page candidates, auth required.

**Step 2: implement.**

**Commit:** `feat(api): chat edit endpoints with one-page enforcement`

---

## Task 6: Frontend api client extensions

**Files:**
- Modify: `web/src/api.ts`

Add:

```ts
streamEdit(id: number, instruction: string, tier?: "haiku"|"sonnet"|"opus"): EventSource
acceptEdit(id: number, proposed_latex: string): Promise<{id, latex_source, updated_at}>
```

`streamEdit` returns an `EventSource` consumer; the caller handles `chunk` and `result` events.

**Commit:** `feat(web): api client streaming edit + accept`

---

## Task 7: Chat sidebar component

**Files:**
- Create: `web/src/components/ChatSidebar.tsx`
- Create: `web/src/components/ChatSidebar.test.tsx`

**Behavior:**
- Input box, message list, "Send" button.
- On send: opens `streamEdit` SSE; appends streamed tokens to the latest "assistant" message.
- Final `result` event sets a `proposed` state object surfaced via `onProposed` callback prop so the parent (Editor) can show the diff view.
- Disabled while a stream is active.

**Step 1: failing test** — mocks `EventSource`, asserts streamed tokens render and `onProposed` called with the result payload.

**Commit:** `feat(web): chat sidebar component`

---

## Task 8: Diff view + page-count badge

**Files:**
- Create: `web/src/components/DiffView.tsx`
- Create: `web/src/components/DiffView.test.tsx`

**Behavior:**
- Input: `{currentLatex, proposedLatex, pageCount, enforced, removedTerms, onAccept, onReject}`.
- Renders side-by-side text diff (use `diff` package).
- Shows page-count badge: ✓ green when `pageCount === 1`, ✗ red otherwise. Accept button disabled when `!enforced`.
- Lists `removedTerms` if any, with red callout.

**Commit:** `feat(web): diff view with page-count badge`

---

## Task 9: Editor wiring

**Files:**
- Modify: `web/src/routes/Editor.tsx`

**Changes:**
- Layout becomes 3 columns: editor | preview | sidebar (resizable).
- Holds `proposed` state; when set, preview swaps for DiffView.
- Accept calls `acceptEdit`, refreshes resume + recompiles preview, closes diff.
- Reject clears `proposed` only.

**Update existing component test** to keep working with the new layout (skip if minor).

**Commit:** `feat(web): wire chat sidebar and diff into editor`

---

## Task 10: E2E smoke

**Files:**
- Modify: `web/e2e/smoke.spec.ts` (extend existing, or new `chat-edit.spec.ts`)

**Scenario:** stub the SSE endpoint at the network layer (Playwright `route`) to return a deterministic diff. Verify diff renders, page-count badge, accept commits new latex, editor reflects update.

**Commit:** `test(web): chat edit + accept e2e smoke`

---

## Done criteria

- `docker compose run --rm api pytest -v` passes (existing 17 + new agent + enforcer + edit suites).
- Vitest passes (existing 2 + ChatSidebar + DiffView).
- Playwright passes (existing + chat-edit).
- A live `RUN_AGENT_SMOKE=1` invocation is documented in README; CI does not require it.
- Editor shows: code editor, PDF preview, chat sidebar. Sending an instruction streams a diff. The diff view shows a page-count badge and an accept-disabled state when `enforced=false`. Accept persists new LaTeX and recompiles.

Next plan: `2026-04-XX-tailor-to-jd.md`.
