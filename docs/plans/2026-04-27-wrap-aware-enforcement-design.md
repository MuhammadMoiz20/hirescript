# Wrap-Aware One-Page Enforcement — Design

Date: 2026-04-27
Status: Approved, ready for implementation plan.

## Problem

`enforce_one_page` (`api/app/services/enforcer.py`) only triggers its repair
loop when Tectonic emits `Overfull \hbox` warnings. LaTeX successfully
soft-wraps long bullets at intra-line spaces, so a bullet that visually spans
two lines produces no warning at all. `parse_overflows` returns `()`,
`_is_clean(page_count, overflows)` returns `True`, and the loop never runs.

The result, observed on real resumes:

- `Optimized PostgreSQL via connection pooling, reducing p95 query latency by 50% and improving overall platform / performance` — wraps to a 2nd visual line.
- `Integrated Dartmouth News RESTful APIs with strict validation, centralizing image and text archives for institutional / compliance.` — same.
- Skills block rows under `\textbf{Languages}{: …} \\` also wrap with no warning.

Page count is technically 1, but the page is visually broken: bullets consume
two lines while the bottom of the page wastes whitespace.

## Goal

Detect per-bullet and per-skill-row wraps at compile time, surface them
through the existing `OverflowHint` channel with the **offending text**
included, and let the existing Haiku→Sonnet repair loop fix them.

Detection must:

- Catch soft wraps that LaTeX silently breaks at spaces.
- Carry the actual bullet text into the hint, so the model knows exactly what
  to shorten.
- Cause zero behavior change when no wraps occur.
- Survive user edits to the document body (instrumentation lives in a
  compile-time preamble shim, not in the user's template).

## Non-goals

- Detection inside `\resumeSubheading` / `\resumeProjectHeading` headings.
  These rarely wrap because dates are short. Deferred.
- General-purpose PDF post-pass detection (approach B from brainstorming).
  Deferred.
- Frontend changes to distinguish wrap hints from hbox hints. The existing
  overflow-count badge is sufficient.
- AI prompt changes beyond a single new sentence telling the model to use the
  `text` field on wrap hints.

## Architecture

Three changes, all backend, all in `api/app/services/`.

### 1. Preamble shim (`api/app/services/latex_shim.py`, new)

A constant LaTeX snippet that `compile_latex` injects into the source before
running Tectonic. The shim:

- Defines `\hsMeasureLine{<text>}`: uses `\settowidth\hs@dim{<text>}` to
  measure the rendered width of `<text>`, compares against `\linewidth` minus
  a 2pt slack, and on overflow emits a single line to the log:

  ```
  HS_WRAP: line=<inputlineno> over=<pt>pt limit=<pt>pt text=<<<\detokenize{<text>}>>>
  ```

  `\detokenize` produces a flat string form of the bullet content (commands
  appear as `\textbf {Foo}`), which is human-readable and model-friendly.

- Inside `\AtBeginDocument`, redefines `\resumeItem`:

  ```latex
  \let\hs@oldResumeItem\resumeItem
  \renewcommand{\resumeItem}[1]{\hsMeasureLine{#1}\hs@oldResumeItem{#1}}
  ```

  `\AtBeginDocument` ensures the user's preamble has finished defining
  `\resumeItem` before we wrap it. If `\resumeItem` is undefined, the shim
  no-ops (`\@ifundefined`).

- Defines `\skillRow{label}{items}`:

  ```latex
  \newcommand{\skillRow}[2]{%
    \textbf{#1}{: #2}%
    \hsMeasureLine{\textbf{#1}: #2}%
    \\%
  }
  ```

  Users adopt this in the Skills block (one mechanical edit, see Template
  edit below).

- Tolerance: 2pt slack. `\linewidth - 2pt`. Avoids false positives at the
  exact boundary.

- Failure mode: every measurement is wrapped in a `\begingroup` so any
  measurement error is contained. The shim never breaks compilation; on
  internal failure it silently no-ops, falling back to current behavior.

Injection point: `compile_latex` finds the line `\begin{document}` and
inserts the shim immediately before it. If the source has no
`\begin{document}` (malformed input), `compile_latex` proceeds unchanged.

### 2. Log parser extension (`api/app/services/compile.py`)

`parse_overflows` currently matches:

```
Overfull \hbox (Xpt too wide).*?at lines N--M
```

Add a second regex:

```
HS_WRAP: line=(\d+) over=([\d.]+)pt limit=([\d.]+)pt text=<<<(.*?)>>>
```

`OverflowHint` gains an optional `text: str | None = None` field. Hbox hints
keep `text=None`. Wrap hints carry the detokenized bullet content.

The two hint sources are merged into a single tuple in source order. Callers
(enforcer, repair_overflow, frontend) need no changes for the basic flow,
because they already iterate `overflows` opaquely.

`_hints_payload` (`asdict`) automatically picks up the new field, so the
agent sees `text` in its hint payload.

### 3. Repair prompt nudge (`api/app/services/agent.py`)

In the `repair_overflow` prompt template, add one sentence:

> When a hint includes a non-null `text` field, that string is the exact
> bullet content that wrapped to a second visual line. Rewrite that bullet
> to fit on one line while preserving protected terms; do not touch other
> bullets unless they also have hints.

This is the highest-leverage change for repair quality. With the offending
text in hand, Haiku reliably one-shots wrap fixes; without it, the model
guesses from line numbers.

### 4. `_is_clean` and the loop

Unchanged. `_is_clean(page_count, overflows)` already gates on
`not overflows`. Once wrap hints land in `overflows`, the loop kicks in
automatically.

`max_iterations` stays at 4. Tier schedule (Haiku ×2, Sonnet ×2) stays.

### 5. Template edit

The standard Jake's-resume Skills block:

```latex
\begin{itemize}[leftmargin=0.15in, label={}]
  \small{\item{
    \textbf{Languages}{: Python, ...} \\
    \textbf{Infrastructure}{: ...} \\
    \textbf{Frameworks}{: ...} \\
    \textbf{DevOps \& Tools}{: ...}
  }}
\end{itemize}
```

becomes:

```latex
\begin{itemize}[leftmargin=0.15in, label={}]
  \small{\item{
    \skillRow{Languages}{Python, ...}
    \skillRow{Infrastructure}{...}
    \skillRow{Frameworks}{...}
    \textbf{DevOps \& Tools}{: ...}
  }}
\end{itemize}
```

(Last row keeps no trailing `\\` and no measurement, since the trailing row
of a Skills block cannot soft-wrap a *next* line into existence — but if it
overflows it'll still trigger an Overfull \hbox the normal way. Actually use
`\skillRow` everywhere for consistency; the final `\\` is harmless inside an
`\item`.)

The built-in template ships with `\skillRow` already in use. Existing user
resumes get a one-time migration nudge: when the Skills block is detected
without `\skillRow`, the UI surfaces an info banner ("Skills wrap detection
unavailable until you migrate to \skillRow"). The migration itself is
out-of-scope for this slice — current users can update manually.

## Data flow

```
candidate LaTeX
  │
  ▼
compile_latex
  │  injects shim before \begin{document}
  ▼
Tectonic (writes log)
  │  log contains:
  │    Overfull \hbox warnings (existing)
  │    HS_WRAP: ... lines (new, from \typeout)
  ▼
parse_overflows
  │  → tuple[OverflowHint, ...] with .text populated for wraps
  ▼
CompileResult { pdf, page_count, overflows }
  ▼
enforce_one_page
  │  if not _is_clean: loop
  ▼
repair_overflow(hints with text)
  │  → revised LaTeX
  ▼
recompile, recheck
```

## Error handling

| Failure | Behavior |
|---|---|
| `\settowidth` errors on exotic content | `\begingroup` contains the error; measurement skipped; compilation continues. |
| Shim's `\@ifundefined{resumeItem}` is true | Shim does not redefine; only `\skillRow` rows are measured. |
| `>>>` literally appears in a bullet | Regex is non-greedy; first match wins. The hint may be slightly truncated; never crashes the parser. Add a unit test for this edge. |
| `HS_WRAP:` line is malformed | Parser drops the line, no hint produced. Logged at debug. |
| Pre-existing `AgentError` during repair | Unchanged: enforcer logs and continues to next iteration. |

## Tests

New tests in `api/tests/test_compile.py`:

1. `test_wrap_detected_for_long_resume_item` — feed a doc with a deliberately
   long `\resumeItem` bullet; assert exactly one `OverflowHint` with
   `text` containing a substring of the bullet, `pt_over > 0`.
2. `test_no_wrap_within_slack` — bullet that ends within 2pt of `\linewidth`
   produces no hint.
3. `test_wrap_detected_for_skill_row` — Skills block using `\skillRow` with a
   long `Frameworks` row; assert hint with `text` containing `Frameworks`.
4. `test_shim_noop_when_no_resumeitem_defined` — minimal doc without the
   resume macros; compile succeeds, no hints.
5. `test_hbox_and_wrap_hints_coexist` — doc with both an Overfull \hbox AND
   a soft-wrapped `\resumeItem`; both hints present.

New tests in `api/tests/test_enforcer.py`:

6. `test_loop_runs_when_only_wraps_present` — mock compile to return
   `page_count=1` and one wrap hint on iter 0, then clean on iter 1; assert
   loop ran once. Today this test would fail because `_is_clean` short-
   circuits.
7. `test_loop_exhausts_when_wraps_persist` — mock compile to keep returning
   wrap hints; assert `enforced=False`, `iterations==4`, tier history is
   `[haiku, haiku, sonnet, sonnet]`.

Existing tests must keep passing. The only behavioral change for
hbox-only flows is the unified hint tuple, which is API-compatible.

## Risks

- **Shim performance.** `\settowidth` adds a measurement per bullet. On a
  typical resume (~25 bullets) the cost is microseconds. Negligible.
- **`\detokenize` artifacts.** The model sees `\textbf {Foo}` not `\textbf{Foo}`.
  Acceptable; the model has handled this form historically.
- **Future template variations.** A template that defines its own bullet
  macro (not `\resumeItem`) is undetected. Out of scope; PDF post-pass
  fallback (approach B) covers this in a future slice.
- **Skills `\skillRow` adoption.** Users on legacy templates won't get
  Skills detection until they migrate. Acceptable; bullets are the bigger
  win and they work automatically.

## Out of scope

- `\resumeSubheading` / `\resumeProjectHeading` heading wrap detection.
- PDF post-pass detection.
- Auto-migration of legacy Skills blocks.
- Frontend distinct rendering of wrap hints vs hbox hints.
- AI prompt overhauls beyond one sentence.
