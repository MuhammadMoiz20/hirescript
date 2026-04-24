# Review Current Work

Review the current changes before handoff or commit.

Run context checks:

```bash
git status --short
git diff --stat
git diff
```

Review checklist:

- Does the change match the requested task and current phase?
- Are later-phase features accidentally included?
- Are unrelated user changes preserved?
- If compile/PDF logic changed, is `page_count` preserved end-to-end?
- Is overflow handled without truncation, clipping, or hidden content?
- Are API contracts typed and explicit?
- Are migrations and models consistent?
- Are frontend states covered for loading, error, empty, and success paths where relevant?
- Did the smallest relevant tests run?

Report:

- Findings first, ordered by severity.
- Verification commands and outcomes.
- Residual risks or skipped tests.
