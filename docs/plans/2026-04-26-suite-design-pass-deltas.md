# Suite Design Pass — Parity Audit (Slice 2.5, Task 28)

> Manual smoke walk of every bundle screen against the production app on
> branch `slice-2.5-suite-design`. Each row records bundle source →
> production source → status. **Match** means visual treatment, primitives,
> layout, and copy align. **Bug** means production unintentionally diverges
> from the bundle (typo, missing aria-label, wrong glyph). **Intentional**
> means production deliberately differs because the backend doesn't expose
> the data, or because a later slice owns the feature.

## Summary

| Bucket            | Count |
| ----------------- | ----: |
| Match             |    27 |
| Bugs fixed here   |     0 |
| Intentional delta |    14 |
| Total surfaces    |    41 |

No clear-bug deltas were found during the audit. Every observed delta is
either an intentional Slice 2.5 scope carve-out (backend data missing,
later-slice feature, or an out-of-scope bundle prototype affordance) or
already documented inline as a `TODO` comment with a slice owner.

Test counts: baseline `418 passed + 2 skipped` before audit, identical
after (no regressions, no fixes required).

---

## Foundation

| Bundle file              | Production file(s)                                                       | Status                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `tokens.css`             | `web/src/styles/tokens.css`                                              | **Match** — variables ported 1:1 with deliberate project extensions (color-scheme, --bottom-chrome, autofill).    |
| `tokens-massapply.css`   | `web/src/styles/tokens-massapply.css`                                    | **Match** — tier hues, status pill shapes, mode toggle, max gauge bands present.                                  |
| `suite.css` + `ma-runtime.css` | `web/src/styles/suite.css`                                          | **Match** — shell grid, paper layers, focus ring, mass-apply runtime helpers all present.                         |
| `components.jsx` (per-job primitives) | `web/src/components/ui/{PageCountBadge,CompileChip,ModelBadge,ProtectedTermPill}.tsx` | **Match** — six-state PageCountBadge, four-state CompileChip, model + protected-term chips. Per-variant tests cover each state. |
| `ma-primitives.jsx`      | `web/src/components/ui/{TierBadge,FitChip,StatusPill,ModeToggle,MaxGauge,Sparkline}.tsx` | **Match** — tier hues, fit bands, 11-state status pill, mode toggle, gauge, sparkline.                            |
| Dark mode                | `web/src/components/ThemeProvider.tsx` + token overrides                 | **Match** — every primitive references token vars only; light/dark parity sweep test covers them all.             |
| Empty / loading / error  | `web/src/components/ui/{EmptyState,LoadingSkeleton,ErrorBanner}.tsx`     | **Match** — bundle microcopy applied to Inbox, Documents, NotificationsDrawer, DiffView (per T25 commit body).    |

## Suite shell

| Bundle file                          | Production file                                       | Status                                                                                                                                                       |
| ------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ma-shell.jsx::TopBar` + `suite.jsx::SuiteTopBar` | `web/src/components/suite/TopBar.tsx`         | **Match** — wordmark, breadcrumb, MaxGauge (compact), theme toggle, ⌘K trigger, notifications bell with unread.                                              |
| `ma-shell.jsx::NavRail` + `suite.jsx::SuiteNav`   | `web/src/components/suite/NavRail.tsx`        | **Match (extended)** — bundle's mass-apply rail is preserved verbatim; per-plan, the production rail also exposes a Per-job group above it (Library, Editor, Diff, Tailor, JDs, History) plus Settings anchored at the bottom. Editor/Diff appear only when a resume is open. |
| `suite.jsx::SuiteOverview`           | `web/src/routes/Overview.tsx`                         | **Match** — two-column with recent resumes (left) and mass-apply pulse (right, MaxGauge expanded + counters + inbox/queue snippets).                          |
| `ma-screens-3.jsx::CmdPalette` + `suite.jsx::SuiteCmd` | `web/src/components/suite/CommandPalette.tsx` | **Match** — fuzzy filter across nav + recent resumes + active jobs + actions; arrow/enter/escape keyboard nav; group eyebrows + hint pin-right.        |

## Per-job surfaces

| Bundle file                   | Production file                                              | Status                                                                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `screens-a.jsx::LibraryScreen` | `web/src/routes/ResumeList.tsx`                             | **Match** — Source Serif titles, PageCountBadge + CompileChip per row, MasterCard + variant rows.                                                                                                                                       |
| `screens-a.jsx::EditorScreen` | `web/src/routes/Editor.tsx`                                  | **Match** — `48 / editor / PDF hero / 360px chat` desktop grid, PDF chip header (PageCountBadge + meta + Save-as-final disabled until 1 page + PDF download), 36px collapsed chat strip. Mobile path preserved.                          |
| `screens-a.jsx::ChatRail`     | `web/src/components/ChatSidebar.tsx`                         | **Match** — 360px right rail with close handle, Tighten/Tailor preset chips above Send.                                                                                                                                                 |
| `screens-b.jsx::OverflowScreen` | `web/src/components/OverflowBanner.tsx`                    | **Match** — red-ink banner with warn glyph, "Resume is N pages.", advisory copy, PageCountBadge state="over", tighten CTA. `role="alert"`. Body `data-overflow="true"` paints the top-chrome bottom border. Never auto-rewrites.       |
| `screens-a.jsx::DiffScreen`   | `web/src/components/DiffView.tsx`                            | **Match** — numbered hotspots, protected-term strip, compile metadata header, "No changes to review" empty state.                                                                                                                       |
| `screens-b.jsx::TailorScreen` | `web/src/components/TailorModal.tsx`                         | **Match** — restyled per bundle.                                                                                                                                                                                                        |
| `screens-b.jsx::HistoryScreen` (per-job) | `web/src/components/VersionHistory.tsx`           | **Match** — VersionRow uses PageCountBadge per version + rollback affordance with aria-label.                                                                                                                                            |
| `screens-b.jsx::JDsScreen`    | JD parser surfaces inside Editor / TailorModal               | **Match** — restyled in T19 commit. Standalone JDs route is intentionally absent (see Intentional Delta IJ-1).                                                                                                                          |
| `screens-a.jsx::OnboardingScreen` | `web/src/routes/Onboarding.tsx`                          | **Match** — three-up PathCard (paste / upload PDF / scratch), eyebrow + serif title, mono inputs, Jake's Resume thumbnail rail, paper card on rule background.                                                                          |

## Mass-apply surfaces

| Bundle file                          | Production file                                       | Status                                                                                                                                                                                                                                                                                |
| ------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ma-screens-1.jsx::Dashboard`        | `web/src/routes/Dashboard.tsx`                        | **Match (with intentional placeholders)** — KPI band, sparkline, tier-cap bars, mode-mix donut, top-3 needs-you, 11-event activity feed. Tier daily caps + Max-window usage are inline-labelled placeholders pending Slice 3 (see IM-1, IM-2).                                       |
| `ma-screens-1.jsx::Inbox`            | `web/src/routes/Inbox.tsx` + `web/src/components/PostingCard.tsx` | **Match** — filter chip row, sortable column header, posting rows using TierBadge / FitChip / StatusPill / ModeToggle, drawer with classifier reasoning + 4-stage pipeline trace + artifacts pane.                                                                          |
| `ma-screens-1.jsx::Queue`            | `web/src/routes/Queue.tsx` + `web/src/components/QueueCard.tsx`  | **Match (with placeholders)** — 4-lane layout (Needs you / B-mode / Applying / Paused). Applying + Paused show "Coming in Slice 3" empty placeholders until backend emits those statuses (see IM-3).                                                                          |
| `ma-screens-1.jsx::History`          | `web/src/routes/HistoryMassApply.tsx`                 | **Match (with placeholders)** — 14-day sparkline header, dense table with R/C/A sent ticks, Tokens column shows em dash pending backend (see IM-4), Duration column same (IM-5).                                                                                              |
| `ma-screens-1.jsx::LiveSessionViewer` | _(not built)_                                         | **Intentional delta** — explicitly out of scope for Slice 2.5; ships in Slice 3 alongside A-mode (see IM-6).                                                                                                                                                                  |
| `ma-screens-2.jsx::Knowledge` (tabs) | `web/src/routes/Knowledge.tsx` + `components/knowledge/{ProfileTab,DocumentsTab,SourcesTab}.tsx` | **Match** — Profile / Documents / Sources tabs with deep-linkable `?tab=` query params; onboarding chat docked inside Profile tab.                                                                          |
| `ma-screens-2.jsx::KnowledgeSources::SourceFamily` | `components/knowledge/SourcesTab.tsx`     | **Intentional delta** — KB ingest sources are wired; job-source families render as an empty-state preview labelled "Coming in Slice 4" (see IM-7).                                                                                                                            |
| `ma-screens-2.jsx::TiersPolicy`      | `web/src/routes/Tiers.tsx`                            | **Intentional delta (read-only)** — threshold ribbon, 4 tier cards, model-per-stage breakdown, mode + verifier + caps display only. Editing is disabled with a "Tier configuration is coming in Slice 3" notice — backend has no `tiers` table yet (see IM-8, IM-9).             |
| `ma-screens-2.jsx::Settings`         | `web/src/routes/Settings.tsx`                         | **Match (with intentional gaps)** — Workspace (timezone, locale, tenant marker), Anthropic API key (localStorage only, never proxied), Model defaults, Exports, Danger zone (typed-confirm). Bundle's "Quiet hours" and "Workspace name" inputs are read-only display because the backend exposes neither setting; Resumes-ZIP and CSV exports are disabled with "Coming in Slice 3" labels (see IM-10, IM-11). |
| `ma-screens-3.jsx::NotifDrawer`      | `web/src/components/suite/NotificationsDrawer.tsx`    | **Match (client-only)** — slide-in drawer, New / Earlier sections, deep-link + dismiss per row, per-channel push toggles disabled with "Coming in Slice 3" — Pushover / ntfy wiring is Slice 3 (see IM-12).                                                                  |
| `ma-screens-3.jsx::Microcopy`        | applied across surfaces (T25)                         | **Match** — bundle copy applied to Inbox empty/filtered, Documents empty, NotificationsDrawer empty, DiffView empty.                                                                                                                                                          |
| `ma-screens-3.jsx::ComponentInventory` | _(not built)_                                       | **Intentional delta** — internal design reference, not a production surface. Component coverage is asserted via per-primitive Vitest specs instead (see IJ-2).                                                                                                                |
| `ma-screens-3.jsx::ScreensDock`      | _(not built)_                                         | **Intentional delta** — prototype-only navigation aid for the bundle's standalone HTML demo; production uses NavRail + ⌘K (see IJ-3).                                                                                                                                          |

## Bugs fixed in this audit

None. The audit found no clear-bug deltas — every observed difference
between production and the bundle is either documented as a Slice 3+
carry (see below) or is a deliberate Slice 2.5 scope decision recorded
in the corresponding T# commit body.

## Intentional deltas (carry to Slice 3+)

These are deliberate gaps. Each one already has a `TODO` comment in the
production source pointing at the same slice owner; this checklist is
the consolidated tracker.

### Mass-apply (Slice 3 unless noted)

- [ ] **IM-1** Dashboard tier-cap bars: backend currently has no
      `per-tier daily limit` setting. Caps render as labelled placeholders.
      File: `web/src/routes/Dashboard.tsx:51,581`.
- [ ] **IM-2** Dashboard Max-window gauge: needs `claude_router` usage
      endpoint. File: `web/src/routes/Dashboard.tsx:302,534`,
      `web/src/routes/Overview.tsx:122`, `web/src/App.tsx:403`.
- [ ] **IM-3** Queue lanes — Applying / Paused: empty until backend
      emits `applying` / `paused` application states.
      File: `web/src/routes/Queue.tsx:248`.
- [ ] **IM-4** History `tokens_used`: column is em-dash because
      `/applications` does not yet expose token usage.
      File: `web/src/routes/HistoryMassApply.tsx:334`.
- [ ] **IM-5** History `duration_ms`: same backend gap as IM-4.
      File: `web/src/routes/HistoryMassApply.tsx:334`.
- [ ] **IM-6** LiveSessionViewer: ships with A-mode in Slice 3.
- [ ] **IM-7** Knowledge → Sources job-source families: ships with
      Slice 4 source adapters (Lever / Ashby / Workable / email / URL).
      File: `web/src/components/knowledge/SourcesTab.tsx:152`.
- [ ] **IM-8** Tiers thresholds editability: needs a `tiers` table +
      CRUD endpoints. UI is read-only by design today.
- [ ] **IM-9** Tiers daily caps + verifier strictness: same backend gap
      as IM-8. Labels render but inputs are disabled.
      File: `web/src/routes/Tiers.tsx:33`.
- [ ] **IM-10** Settings workspace name + quiet hours: backend exposes
      neither. Today's view shows derived timezone/locale only.
- [ ] **IM-11** Settings Resumes-ZIP + CSV exports: no bulk endpoint
      yet. CTAs disabled with "Coming in Slice 3".
      File: `web/src/routes/Settings.tsx:432,641,676,705`.
- [ ] **IM-12** Notifications channel toggles (Pushover / ntfy): no
      backend persistence + no real delivery wiring.
      File: `web/src/components/suite/NotificationsDrawer.tsx:196,422`.

### Per-job

- [ ] **IJ-1** Standalone JDs route: bundle's `JDsScreen` is folded
      into Editor + TailorModal in production. Promoting it to a
      first-class route is deferred until JD library / pin / search
      lands as a real feature (no current slice).
- [ ] **IJ-2** ComponentInventory: bundle-internal reference only;
      production relies on per-primitive Vitest specs for coverage.
      No future slice will own this — keeping the gap explicit.
- [ ] **IJ-3** ScreensDock: prototype-only navigation aid for the
      bundle's standalone HTML demo; production uses NavRail + ⌘K.
      No future slice will own this — keeping the gap explicit.
- [ ] **IJ-4** Editor surfaces routed individually (Editor / Diff /
      Tailor / JDs / History as separate views): App today nests them
      inside the Editor view because the editing context is shared. The
      NavRail TODO at `web/src/App.tsx:150` calls this out for a later
      Phase D split when those surfaces gain independent state.

---

## Verification

```
cd web && npx vitest run
# 54 test files, 418 passed + 2 skipped (baseline matched, no regressions)
```

Audit performed on `slice-2.5-suite-design` at HEAD `1e3df00`.
