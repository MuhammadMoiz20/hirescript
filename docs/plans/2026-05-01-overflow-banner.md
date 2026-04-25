# Phase 7 — Manual-edit Overflow Banner + One-Click "Ask Claude to Tighten"

> **For Claude:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`.

**Goal:** When the user manually edits LaTeX (or saves a section form) and the result compiles to >1 page, the editor shows a blocking advisory banner with a one-click "Ask Claude to tighten" button. Per the design rule, we never rewrite the user's LaTeX behind their back — the banner only nudges; the action is explicit.

**Anchor:** design doc — "Manual editing is advisory, not auto-mutating".

**Scope:**
- Frontend-only banner; backend already returns `page_count` from compile (`X-Page-Count` header) and `tailor`/`accept`/`onboard` payloads.
- "Ask Claude to tighten" wires the existing `streamEdit` SSE with a canned instruction, lands a proposal in the existing `DiffView`.
- No new endpoints; minimal API surface change to expose `page_count` from the compile call as a JSON-readable value (currently it's only a response header).

**Out of scope:** Auto-tighten on save; passive page-count meter (we already show it on diffs and history rows).

---

## Task 1: Expose page_count from compile response in api client

**Files:**
- Modify: `web/src/api.ts`

`compileResume` currently returns the PDF blob directly. Wrap it to return `{blob, pageCount}` by reading the `X-Page-Count` header. Keep backwards-compat: existing call sites use `await api.compileResume(id)` and pass the blob to `PdfPreview`. Update those to destructure.

Signature change:

```ts
compileResume(id: number): Promise<{ pdf: Blob; pageCount: number }>
```

**Commit:** `feat(web): compileResume returns blob + page count`

---

## Task 2: OverflowBanner component

**Files:**
- Create: `web/src/components/OverflowBanner.tsx`
- Create: `web/src/components/OverflowBanner.test.tsx`

```tsx
interface Props {
  pageCount: number;
  onTighten: () => void;
  busy?: boolean;
}
```

Visible only when `pageCount > 1`. Renders red strip:
> Resume is {pageCount} pages. Fix before saving as final, or ask Claude to tighten without dropping protected terms.

Plus a button "Ask Claude to tighten".

Tests: hidden when pageCount <= 1, visible when > 1, button calls `onTighten`.

**Commit:** `feat(web): OverflowBanner component`

---

## Task 3: Editor wiring

**Files:**
- Modify: `web/src/routes/Editor.tsx`

After every successful compile, store the latest `pageCount` in state. Render `<OverflowBanner pageCount={pageCount} onTighten={tighten} busy={tightening}/>` above the editor body in BOTH form and latex views.

`tighten` handler: opens an instruction-less edit by calling `api.streamEdit(id, "Tighten this resume so it fits on exactly one page. Do not drop protected terms.", "haiku", { onChunk, onResult, onError })`. Same callback shape as ChatSidebar; on `onResult`, set `proposed` so the existing DiffView appears. Reuse the existing accept/reject flow.

The banner is also visible in History view; clicking "Ask Claude to tighten" works there too because it operates on the current resume state, not on the open view.

**Commit:** `feat(web): overflow banner wired in editor`

---

## Task 4: E2E

**Files:**
- Create: `web/e2e/overflow.spec.ts`

Stubs:
- `GET /api/resumes/grouped` → one master.
- `GET /api/resumes/{id}` → resume with multi-page LaTeX.
- `GET /api/resumes/{id}/sections` → minimal payload.
- `POST /api/resumes/{id}/compile` → 200 with `X-Page-Count: 2` and a tiny PDF.
- `POST /api/resumes/{id}/edits` → SSE stream with a 1-page result (so the diff view shows enforced=true).

Flow: log in → open master → click Compile → banner appears with "2 pages" → click "Ask Claude to tighten" → diff view appears with a 1-page badge → click Accept.

**Commit:** `test(web): overflow banner e2e`

---

## Done criteria

- Vitest: existing 28 + 3 new pass.
- Playwright: existing 6 + 1 new pass.
- Editor displays the banner whenever the latest compile reports >1 page in any view.
