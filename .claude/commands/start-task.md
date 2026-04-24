# Start Task

Use this prompt at the beginning of a new HireScript task.

First, inspect:

```bash
git status --short
find . -maxdepth 3 -type f | sort
```

Then read the relevant context:

- `CLAUDE.md`
- `.claude/README.md`
- `docs/plans/2026-04-24-walking-skeleton.md`
- `docs/plans/2026-04-24-resume-maker-design.md`

Before editing, state:

- Which plan/task you are following.
- Which files you expect to touch.
- Which tests or commands should verify the work.

Implementation reminders:

- Keep the change focused.
- Do not overwrite unrelated user changes.
- Use Docker Compose commands once the scaffold exists.
- Write tests first when following the walking-skeleton plan.
- Keep later-phase features out unless the user explicitly asks for them.
