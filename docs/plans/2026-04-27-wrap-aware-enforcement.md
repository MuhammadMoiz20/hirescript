# Wrap-Aware One-Page Enforcement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect soft-wrapped resume bullets and skill rows at compile time and feed them into the existing one-page repair loop with the offending text included.

**Architecture:** Inject a LaTeX preamble shim that defines `\hsMeasureLine{...}` and wraps `\resumeItem` plus a new `\skillRow` so each one emits a parseable `HS_WRAP:` line to Tectonic's log when its content would soft-wrap. Extend `parse_overflows` to ingest those lines into `OverflowHint`s with the `snippet` field populated. The existing `enforce_one_page` loop then runs unchanged because `_is_clean` already gates on `not overflows`. One sentence is added to the repair prompt so the model knows the snippet on a wrap hint is the exact bullet to shorten.

**Tech Stack:** Python 3.11, FastAPI, LaTeX (Tectonic/XeLaTeX), pytest, async SQLAlchemy 2.x.

**Reference design:** `docs/plans/2026-04-27-wrap-aware-enforcement-design.md`

---

## Pre-flight

Read these before starting:

- `docs/plans/2026-04-27-wrap-aware-enforcement-design.md` — full design.
- `api/app/services/compile.py` — `compile_latex`, `parse_overflows`, `OverflowHint`, `_PDFTEX_SHIM`, `_inject_shim`.
- `api/app/services/enforcer.py` — `enforce_one_page`, `_is_clean`, `_hints_payload`.
- `api/app/services/agent.py` — `repair_overflow` and its prompt template.
- `api/tests/test_compile.py`, `api/tests/test_enforcer.py` — existing test conventions.

Run all backend tests once before starting to confirm a green baseline:

```bash
docker compose run --rm api pytest -q
```

Expected: all tests pass. If anything is red on `main`, stop and report.

Use the `superpowers:test-driven-development` skill for every task that touches code. Each task in this plan follows the test-first rhythm: failing test → minimal impl → green test → commit.

---

## Task 1: Extend `OverflowHint` parsing for `HS_WRAP` lines (no shim yet)

We start with the parser because it's pure Python, easy to TDD, and unblocks every later task. The shim doesn't exist yet, so we test the parser by feeding it synthetic log strings.

We will **reuse** the existing `OverflowHint.snippet` field for wrap text rather than adding a new field. This keeps the API stable and the hint payload to the agent unchanged in shape.

**Files:**
- Modify: `api/app/services/compile.py` (add `_WRAP_RE`, extend `parse_overflows`)
- Modify: `api/tests/test_compile.py` (new tests)

**Step 1.1: Write failing parser tests**

Append to `api/tests/test_compile.py`:

```python
from app.services.compile import parse_overflows


def test_parse_overflows_extracts_wrap_hint():
    log = (
        "Some preamble\n"
        "HS_WRAP: line=87 over=14.20pt limit=396.00pt text=<<<Optimized PostgreSQL via connection pooling, reducing p95 query latency by 50%.>>>\n"
        "Trailing junk\n"
    )
    hints = parse_overflows(log)
    assert len(hints) == 1
    h = hints[0]
    assert h.line_start == 87
    assert h.line_end == 87
    assert h.overflow_pt == 14.20
    assert "Optimized PostgreSQL" in h.snippet


def test_parse_overflows_merges_hbox_and_wrap_in_source_order():
    log = (
        "Overfull \\hbox (5.00pt too wide) in paragraph at lines 12--13\n"
        "[]\\OT1/cmr/m/n/10.95 some overfull text fragment\n"
        "HS_WRAP: line=42 over=8.00pt limit=396.00pt text=<<<a wrapped bullet>>>\n"
    )
    hints = parse_overflows(log)
    assert len(hints) == 2
    assert hints[0].line_start == 12
    assert hints[0].overflow_pt == 5.0
    assert hints[1].line_start == 42
    assert hints[1].snippet == "a wrapped bullet"


def test_parse_overflows_drops_malformed_wrap_line():
    log = "HS_WRAP: this line is malformed and should be ignored\n"
    assert parse_overflows(log) == ()


def test_parse_overflows_handles_triple_angle_in_text():
    # If a bullet legitimately contains '>>>', the non-greedy match takes
    # the first closing '>>>'. We accept slight truncation; we never crash.
    log = "HS_WRAP: line=5 over=1.00pt limit=10.00pt text=<<<a>>>extra>>>\n"
    hints = parse_overflows(log)
    assert len(hints) == 1
    assert hints[0].snippet == "a"
```

**Step 1.2: Run tests, expect failure**

```bash
docker compose run --rm api pytest api/tests/test_compile.py -k "wrap" -v
```

Expected: 4 failures, all due to the parser ignoring `HS_WRAP:` lines.

**Step 1.3: Implement parser extension**

In `api/app/services/compile.py`, add below `_OVERFULL_RE`:

```python
_WRAP_RE = re.compile(
    r"HS_WRAP: line=(\d+) over=([\d.]+)pt limit=([\d.]+)pt text=<<<(.*?)>>>"
)
```

Replace `parse_overflows` with a version that scans for both patterns and merges results in source order:

```python
def parse_overflows(log: str) -> tuple[OverflowHint, ...]:
    """Extract overflow hints from Tectonic's combined log output.

    Two sources:
      * Overfull \\hbox warnings — emitted by TeX when a line cannot be broken
        and exceeds \\hsize.
      * HS_WRAP: ... lines — emitted by our preamble shim when a bullet or
        skill row's measured width exceeds \\linewidth, indicating a soft
        wrap that TeX silently broke at a space.
    Hints are returned in the order they appear in the log so callers can
    reason about them positionally.
    """
    hints: list[tuple[int, OverflowHint]] = []
    lines = log.splitlines()
    for idx, line in enumerate(lines):
        m = _OVERFULL_RE.search(line)
        if m:
            snippet = ""
            for j in range(idx + 1, min(idx + 4, len(lines))):
                candidate = lines[j].strip()
                if not candidate:
                    continue
                if candidate.startswith("[]") or candidate.startswith("\\"):
                    snippet = _strip_tex_font_prefix(candidate)
                    break
            hints.append((idx, OverflowHint(
                overflow_pt=float(m.group(1)),
                line_start=int(m.group(2)),
                line_end=int(m.group(3)),
                snippet=snippet,
            )))
            continue
        w = _WRAP_RE.search(line)
        if w:
            line_no = int(w.group(1))
            hints.append((idx, OverflowHint(
                overflow_pt=float(w.group(2)),
                line_start=line_no,
                line_end=line_no,
                snippet=w.group(4),
            )))
    hints.sort(key=lambda pair: pair[0])
    return tuple(h for _, h in hints)
```

**Step 1.4: Run tests, expect pass**

```bash
docker compose run --rm api pytest api/tests/test_compile.py -v
```

Expected: all `test_compile.py` tests pass, including the 4 new ones. Existing hbox tests remain green.

**Step 1.5: Commit**

```bash
git add api/app/services/compile.py api/tests/test_compile.py
git commit -m "feat(api): parse HS_WRAP hints from compile log"
```

---

## Task 2: Add the LaTeX preamble shim that emits `HS_WRAP` for `\resumeItem`

Now that the parser understands the format, define the shim that produces it. This task only handles `\resumeItem`; `\skillRow` comes in Task 3.

**Files:**
- Create: `api/app/services/latex_shim.py`
- Modify: `api/app/services/compile.py` (compose `_WRAP_SHIM` into the injected preamble)
- Modify: `api/tests/test_compile.py` (integration test running real Tectonic)

**Step 2.1: Write the failing integration test**

Append to `api/tests/test_compile.py`:

```python
import textwrap

from app.services.compile import compile_latex


_LONG_BULLET = (
    "Optimized PostgreSQL via connection pooling, reducing p95 query "
    "latency by 50% and improving overall platform performance across "
    "every region of the deployment fleet."
)


def _minimal_resume(item_text: str) -> str:
    # Minimal Jake's-resume-like skeleton with a single \resumeItem.
    return textwrap.dedent(rf"""
    \documentclass[letterpaper,10pt]{{article}}
    \usepackage[margin=0.5in]{{geometry}}
    \usepackage{{enumitem}}
    \newcommand{{\resumeItem}}[1]{{\item\small{{#1}}}}
    \newcommand{{\resumeItemListStart}}{{\begin{{itemize}}[leftmargin=0.15in]}}
    \newcommand{{\resumeItemListEnd}}{{\end{{itemize}}}}
    \begin{{document}}
    \resumeItemListStart
    \resumeItem{{ {item_text} }}
    \resumeItemListEnd
    \end{{document}}
    """).strip()


def test_compile_emits_wrap_hint_for_long_resume_item():
    src = _minimal_resume(_LONG_BULLET)
    result = compile_latex(src)
    assert result.page_count == 1
    assert len(result.overflows) >= 1
    wrap = next((h for h in result.overflows
                 if "Optimized PostgreSQL" in h.snippet), None)
    assert wrap is not None, f"expected wrap hint, got {result.overflows!r}"
    assert wrap.overflow_pt > 0


def test_compile_no_wrap_hint_for_short_resume_item():
    src = _minimal_resume("Short bullet that fits on one line easily.")
    result = compile_latex(src)
    assert result.page_count == 1
    assert all("Short bullet" not in h.snippet for h in result.overflows)
```

**Step 2.2: Run tests, expect failure**

```bash
docker compose run --rm api pytest api/tests/test_compile.py::test_compile_emits_wrap_hint_for_long_resume_item -v
```

Expected: failure — `result.overflows` is empty because the shim doesn't exist yet.

**Step 2.3: Create `latex_shim.py`**

Write `api/app/services/latex_shim.py`:

```python
"""LaTeX preamble shim that surfaces soft-wrapped resume content as
parseable warnings in Tectonic's log.

`compile_latex` injects WRAP_SHIM into every document before
\\documentclass executes (alongside the existing pdfTeX compatibility
shim). The shim:

  * Defines \\hsMeasureLine{<text>} which measures the rendered width of
    <text> and, if it exceeds \\linewidth minus a 2pt slack, emits a
    single line of the form

        HS_WRAP: line=<n> over=<pt>pt limit=<pt>pt text=<<<...>>>

    via \\typeout. \\detokenize is used so the captured text is a flat
    string a downstream parser/model can read.

  * After \\AtBeginDocument runs the document's preamble, redefines
    \\resumeItem (if defined) so each bullet is measured before it
    renders. Failure modes (undefined macro, measurement errors) are
    swallowed so the shim never breaks compilation.

  * Defines \\skillRow{label}{items} for use in Skills blocks so each
    row is measured the same way bullets are.

The shim is a single string constant; tests against compile output
exercise its behavior end-to-end.
"""

WRAP_SHIM = r"""
\makeatletter
\newdimen\hs@dim
\newdimen\hs@limit
% Tolerance: declare overflow only when content exceeds \linewidth by >2pt.
\def\hs@slack{2pt}

% Measure <text> against current \linewidth. On overflow, emit one
% HS_WRAP: line to the log via \typeout. \detokenize turns the
% argument into a flat token string suitable for log scraping.
\long\def\hsMeasureLine#1{%
  \begingroup
    \settowidth{\hs@dim}{#1}%
    \hs@limit=\linewidth
    \advance\hs@limit by -\hs@slack
    \ifdim\hs@dim>\hs@limit
      \edef\hs@over{\strip@pt\dimexpr\hs@dim-\linewidth\relax}%
      \edef\hs@lim{\strip@pt\linewidth}%
      \typeout{HS_WRAP: line=\the\inputlineno\space over=\hs@over pt limit=\hs@lim pt text=<<<\detokenize{#1}>>>}%
    \fi
  \endgroup
}

% Wrap \resumeItem after the user's preamble has defined it.
\AtBeginDocument{%
  \@ifundefined{resumeItem}{}{%
    \let\hs@oldResumeItem\resumeItem
    \renewcommand{\resumeItem}[1]{\hsMeasureLine{##1}\hs@oldResumeItem{##1}}%
  }%
}

% \skillRow{label}{items}: typeset the row and measure it. Templates
% adopt this in place of raw \textbf{Label}{: items} \\ rows so wrap
% detection works in Skills blocks too.
\newcommand{\skillRow}[2]{%
  \textbf{#1}{: #2}%
  \hsMeasureLine{\textbf{#1}: #2}%
  \\%
}
\makeatother
""".lstrip("\n")
```

**Step 2.4: Wire the shim into `compile_latex`**

In `api/app/services/compile.py`:

- Add at the top: `from app.services.latex_shim import WRAP_SHIM`
- Change `_inject_shim` so it also appends `WRAP_SHIM` after `_PDFTEX_SHIM`:

```python
def _inject_shim(source: str) -> str:
    """Insert the pdfTeX compatibility shim and the wrap-detection shim
    immediately before \\documentclass (or at the start if no
    \\documentclass is present)."""
    combined = _PDFTEX_SHIM + WRAP_SHIM
    match = re.search(r"\\documentclass", source)
    if not match:
        return combined + source
    return source[: match.start()] + combined + source[match.start():]
```

**Step 2.5: Run tests, expect pass**

```bash
docker compose run --rm api pytest api/tests/test_compile.py -v
```

Expected: all tests pass. The new `test_compile_emits_wrap_hint_for_long_resume_item` and `test_compile_no_wrap_hint_for_short_resume_item` are green. Existing tests (including the Jake's-roundtrip suite) remain green. **If existing tests fail** because some legitimate short bullet now trips the 2pt slack, increase the slack to 3pt in the shim and re-run; do not weaken the test assertions.

**Step 2.6: Commit**

```bash
git add api/app/services/latex_shim.py api/app/services/compile.py api/tests/test_compile.py
git commit -m "feat(api): emit HS_WRAP hints from \\resumeItem soft wraps"
```

---

## Task 3: Add `\skillRow` detection

Now extend the shim's behavior to skill rows. The macro is already in `WRAP_SHIM` from Task 2 — this task only adds tests confirming it works.

**Files:**
- Modify: `api/tests/test_compile.py`

**Step 3.1: Write failing test**

Append to `api/tests/test_compile.py`:

```python
def test_compile_emits_wrap_hint_for_long_skill_row():
    src = textwrap.dedent(r"""
    \documentclass[letterpaper,10pt]{article}
    \usepackage[margin=0.5in]{geometry}
    \usepackage{enumitem}
    \begin{document}
    \begin{itemize}[leftmargin=0.15in, label={}]
      \small{\item{
        \skillRow{Frameworks}{React, Next.js, Node.js, FastAPI, PyTorch, TensorFlow, gRPC, GraphQL, Express, NestJS, Django, Flask, Spring Boot}
      }}
    \end{itemize}
    \end{document}
    """).strip()
    result = compile_latex(src)
    assert result.page_count == 1
    wrap = next((h for h in result.overflows
                 if "Frameworks" in h.snippet), None)
    assert wrap is not None, f"expected skill-row wrap, got {result.overflows!r}"
```

**Step 3.2: Run, expect pass on first try**

```bash
docker compose run --rm api pytest api/tests/test_compile.py::test_compile_emits_wrap_hint_for_long_skill_row -v
```

Expected: PASS. The shim already defines `\skillRow`; if this fails, debug the shim macro definition before proceeding.

**Step 3.3: Add no-op safety test**

Append:

```python
def test_compile_no_wrap_for_minimal_doc_without_resume_macros():
    src = textwrap.dedent(r"""
    \documentclass{article}
    \begin{document}
    Hello world.
    \end{document}
    """).strip()
    result = compile_latex(src)
    assert result.page_count == 1
    assert result.overflows == ()
```

**Step 3.4: Run, expect pass**

```bash
docker compose run --rm api pytest api/tests/test_compile.py -v
```

Expected: all green.

**Step 3.5: Commit**

```bash
git add api/tests/test_compile.py
git commit -m "test(api): cover \\skillRow wrap detection and no-op fallback"
```

---

## Task 4: Make `enforce_one_page` actually run on wrap-only inputs

Today, when `page_count == 1` and overflows are empty, the loop returns immediately. With Task 1+2 in place, wrap hints will be in `overflows`, so `_is_clean` already keeps the loop running. But there is no test asserting that, and the existing `test_enforcer.py` tests should be reviewed for anything that hardcodes "no overflows means done."

**Files:**
- Modify: `api/tests/test_enforcer.py`

**Step 4.1: Write failing test**

Append to `api/tests/test_enforcer.py` (mirror the existing mock pattern already used in that file; if the file mocks `compile_latex` and `repair_overflow` via `monkeypatch`, follow that style):

```python
import pytest

from app.services import enforcer
from app.services.compile import CompileResult, OverflowHint


@pytest.mark.asyncio
async def test_enforce_runs_loop_when_only_wraps_present(monkeypatch):
    """A page_count==1 doc with wrap hints must trigger the repair loop;
    today this would short-circuit because _is_clean only looked at
    Overfull \\hbox warnings."""

    wrap_hint = OverflowHint(
        overflow_pt=12.0, line_start=87, line_end=87,
        snippet="Optimized PostgreSQL via connection pooling, reducing p95...",
    )
    # First compile: 1 page but a wrap hint. Second compile: clean.
    compile_results = iter([
        CompileResult(pdf=b"%PDF-1", page_count=1, overflows=(wrap_hint,)),
        CompileResult(pdf=b"%PDF-2", page_count=1, overflows=()),
    ])
    monkeypatch.setattr(
        enforcer, "compile_latex",
        lambda src: next(compile_results),
    )

    async def fake_repair(**kwargs):
        # Sanity: hint with snippet is forwarded via overflow_hints.
        assert kwargs["overflow_hints"], "wrap hint must be forwarded"
        assert "Optimized PostgreSQL" in kwargs["overflow_hints"][0]["snippet"]
        return {"diff": "REVISED LATEX"}

    monkeypatch.setattr(enforcer, "repair_overflow", fake_repair)

    result = await enforcer.enforce_one_page(
        candidate_latex="ORIGINAL LATEX",
        protected_terms=["PostgreSQL"],
    )
    assert result.enforced is True
    assert result.iterations == 1
    assert result.latex == "REVISED LATEX"


@pytest.mark.asyncio
async def test_enforce_exhausts_when_wraps_persist(monkeypatch):
    wrap_hint = OverflowHint(
        overflow_pt=12.0, line_start=87, line_end=87,
        snippet="bullet that never gets shorter",
    )
    monkeypatch.setattr(
        enforcer, "compile_latex",
        lambda src: CompileResult(pdf=b"%PDF", page_count=1, overflows=(wrap_hint,)),
    )

    async def fake_repair(**kwargs):
        return {"diff": "STILL TOO LONG"}

    monkeypatch.setattr(enforcer, "repair_overflow", fake_repair)

    result = await enforcer.enforce_one_page(
        candidate_latex="ORIGINAL",
        protected_terms=[],
        max_iterations=4,
    )
    assert result.enforced is False  # page_count==1 but overflows remain
    assert result.iterations == 4
    assert result.tier_history == ["haiku", "haiku", "sonnet", "sonnet"]
```

Note: `enforce_one_page` calls `compile_latex` via `asyncio.to_thread`. For monkeypatching to work, replace the symbol on the `enforcer` module object as shown above; `to_thread` will call whatever is bound there.

If `enforce_one_page` currently sets `enforced = current_page_count == 1` at the exhausted return (it does — see `enforcer.py:182`), the second test's `enforced is False` assertion forces us to tighten that line. Update the design accordingly: a doc with persistent wraps is **not** enforced.

**Step 4.2: Run, expect failure on the second test**

```bash
docker compose run --rm api pytest api/tests/test_enforcer.py -v
```

Expected: `test_enforce_runs_loop_when_only_wraps_present` passes (the loop already runs because `_is_clean` checks `not overflows`). `test_enforce_exhausts_when_wraps_persist` **fails** because `enforced` is currently `True` whenever `page_count == 1`, regardless of remaining wraps.

**Step 4.3: Tighten the exhaustion `enforced` flag**

In `api/app/services/enforcer.py`, change the final return:

```python
    return EnforceResult(
        latex=current_latex,
        pdf=current_pdf,
        page_count=current_page_count,
        iterations=iterations,
        enforced=_is_clean(current_page_count, current_overflows),
        tier_history=tier_history,
        log=log,
        overflows=current_overflows,
    )
```

Remove the misleading inline comment "one-page rule satisfied even if overflows remain" — it's no longer the contract.

**Step 4.4: Run, expect pass**

```bash
docker compose run --rm api pytest api/tests/test_enforcer.py -v
```

Expected: both new tests pass; existing tests still pass. If an existing test now fails because it assumed `enforced=True` with leftover overflows, that test was encoding the bug we're fixing — update it to reflect the new contract and document why in the commit message.

**Step 4.5: Commit**

```bash
git add api/app/services/enforcer.py api/tests/test_enforcer.py
git commit -m "fix(api): treat persistent wraps as non-enforced in one-page loop"
```

---

## Task 5: Tell the repair model about the snippet field

The model already receives `overflow_hints` with `snippet` for Overfull \hbox cases. With Tasks 1–2 it now receives `snippet` for wraps too. Add one sentence to the prompt template so the model treats it as authoritative.

**Files:**
- Modify: `api/app/services/agent.py` (the prompt template inside `repair_overflow`)
- Modify: `api/tests/test_agent_service.py` (or the equivalent existing test that asserts the prompt contents)

**Step 5.1: Locate the prompt**

```bash
grep -n "overflow_hints\|repair_overflow\|protected_terms" api/app/services/agent.py | head -40
```

Identify the function/template that builds the user-facing instructions for `repair_overflow`. Read 30–50 lines of context around it before editing.

**Step 5.2: Write failing assertion test**

If `test_agent_service.py` already has a test that captures the rendered prompt sent to the LLM (search for `"Overfull"` or `"protected_terms"` in tests), extend it. Otherwise, add a new test that mocks the LLM client and inspects the prompt:

```python
@pytest.mark.asyncio
async def test_repair_prompt_mentions_snippet_field(monkeypatch):
    captured = {}

    async def fake_call(model, messages, **kw):
        captured["messages"] = messages
        return {"diff": "FAKE"}

    # Monkeypatch the actual LLM-call helper used inside repair_overflow.
    # Adjust the symbol name to match what agent.py uses
    # (e.g. _call_anthropic, _llm_call, etc).
    from app.services import agent
    monkeypatch.setattr(agent, "<LLM_CALL_SYMBOL>", fake_call)

    await agent.repair_overflow(
        current_latex="\\documentclass{article}\\begin{document}x\\end{document}",
        last_diff="",
        page_count=1,
        protected_terms=["PostgreSQL"],
        tier="haiku",
        overflow_hints=[{
            "overflow_pt": 12.0, "line_start": 87, "line_end": 87,
            "snippet": "Optimized PostgreSQL via connection pooling, reducing p95...",
        }],
    )
    flat = "\n".join(m["content"] if isinstance(m["content"], str)
                     else str(m["content"]) for m in captured["messages"])
    assert "snippet" in flat.lower()
    assert "one line" in flat.lower() or "single line" in flat.lower()
```

Replace `<LLM_CALL_SYMBOL>` with the real helper name once located.

**Step 5.3: Run, expect failure**

```bash
docker compose run --rm api pytest api/tests/test_agent_service.py::test_repair_prompt_mentions_snippet_field -v
```

Expected: failure (prompt doesn't mention "snippet"/"one line").

**Step 5.4: Add the sentence**

In the `repair_overflow` prompt template, immediately after the existing instructions about overflows and protected terms, add:

> When a hint includes a non-empty `snippet`, that string is the exact bullet content that wrapped to a second visual line. Rewrite that specific bullet to fit on one line while preserving protected terms; leave other bullets alone unless they also have hints.

**Step 5.5: Run, expect pass**

```bash
docker compose run --rm api pytest api/tests/test_agent_service.py -v
```

Expected: green.

**Step 5.6: Commit**

```bash
git add api/app/services/agent.py api/tests/test_agent_service.py
git commit -m "feat(api): instruct repair model to use wrap snippet as authoritative target"
```

---

## Task 6: End-to-end smoke against the real template

Sanity-check the whole pipeline against a near-replica of the user's pasted resume, with Skills already migrated to `\skillRow`. Lives in tests so it runs in CI.

**Files:**
- Create: `api/tests/fixtures/jakes_with_wraps.tex` (full resume with three known-wrapping bullets and one wrapping skill row)
- Modify: `api/tests/test_compile.py`

**Step 6.1: Capture the fixture**

Save a copy of the user's resume `.tex` (with the three flagged bullets intact AND with the four `\textbf{...}{:...}\\` lines converted to `\skillRow{...}{...}`) to `api/tests/fixtures/jakes_with_wraps.tex`.

**Step 6.2: Add an integration test**

Append:

```python
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"


def test_compile_real_resume_flags_known_bullet_wraps():
    src = (FIXTURES / "jakes_with_wraps.tex").read_text()
    result = compile_latex(src)
    snippets = " | ".join(h.snippet for h in result.overflows)
    # Three bullets reported by the user as visibly wrapping:
    assert "Optimized PostgreSQL" in snippets
    assert "Dartmouth News" in snippets
    assert "Shipped unpublish-assignments" in snippets
```

**Step 6.3: Run**

```bash
docker compose run --rm api pytest api/tests/test_compile.py::test_compile_real_resume_flags_known_bullet_wraps -v
```

Expected: PASS. If a known-wrapping bullet is missed, increase the slack tolerance only as a last resort — first inspect the Tectonic log (`/tmp/...doc.log`) to verify whether `\hsMeasureLine` actually fired for that bullet.

**Step 6.4: Commit**

```bash
git add api/tests/fixtures/jakes_with_wraps.tex api/tests/test_compile.py
git commit -m "test(api): real-resume regression for wrap detection"
```

---

## Task 7: Final verification

**Step 7.1: Full backend suite**

```bash
docker compose run --rm api pytest -q
```

Expected: all green. Investigate any new failures; do not commit a "skip" or relax assertions to make them pass.

**Step 7.2: Manual sanity (optional but recommended)**

If a dev environment is running, paste the user's resume into the editor (with Skills migrated to `\skillRow`), trigger compile, and confirm the overflow-count badge in the UI now shows the wrap hints. The frontend needs no changes to display them.

**Step 7.3: Verify with `superpowers:verification-before-completion`**

Use that skill to confirm: tests pass, no skipped tests, plan tasks completed, no stray TODOs in implementation.

---

## Open questions for the executor

- **Slack tuning.** 2pt was chosen as a guess. If task 2's tests pass cleanly on first run, do not change it. If they false-positive on previously-fine bullets, escalate to 3pt and only then to 4pt; record the final value in a code comment.
- **Trailing `\skillRow`.** The shim's `\skillRow` always emits a trailing `\\`. In the very last row of a Skills `\item`, that adds a blank line. Acceptable visually; if it shifts layout in the real fixture, change `\skillRow` to make the trailing `\\` optional via a starred form.
- **Detokenize artifacts.** The model will see `\textbf {Foo}` not `\textbf{Foo}` in `snippet`. If task 5's repairs come back with that form spliced into the LaTeX, instruct the model in the prompt to normalize spacing. Out of scope for the first cut.

---

Plan complete and saved to `docs/plans/2026-04-27-wrap-aware-enforcement.md`. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks. Fast iteration, you stay in this session.

**2. Parallel Session (separate)** — Open a new session in this worktree with `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
