# Claude Project Helpers

This directory contains prompts and local guidance for using Claude Code on HireScript.

## Suggested Use

- Use `/execute-walking-skeleton` when implementing `docs/plans/2026-04-24-walking-skeleton.md`.
- Use `/start-task` at the beginning of a narrower coding task to load the right context.
- Use `/review-current-work` before handing work back or committing.
- Use the agents in `.claude/agents/` for focused reviews or delegated implementation if your Claude Code setup supports project agents.

## Ground Rules

- `CLAUDE.md` is the source of always-on instructions.
- `docs/plans/` is the source of product and implementation truth.
- Keep implementation aligned with the current phase. The walking skeleton excludes AI editing, variants, PDF upload, Marker, MinIO, and deployment.
- The one-page resume constraint must be preserved whenever compile, AI, diff, versioning, or PDF preview code is touched.

## Maintenance

Update these files when:

- A new implementation plan is added.
- The stack changes.
- The walking skeleton is completed and commands become real.
- A Claude workflow repeatedly needs the same prompt or checklist.

Keep `CLAUDE.md` under 300 lines so it stays easy for agents to load and follow.
