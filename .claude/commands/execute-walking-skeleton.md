# Execute Walking Skeleton

Implement `docs/plans/2026-04-24-walking-skeleton.md` task-by-task.

Required behavior:

1. Use the `superpowers:executing-plans` skill.
2. Read the whole current task before editing.
3. Write the failing test first when the task specifies one.
4. Implement only the files and behavior for the current numbered task.
5. Run the smallest relevant verification command.
6. Commit after each task using the commit message specified in the plan.
7. Stop and report clearly if a task cannot be completed because of environment, Docker, dependency, or unclear plan issues.

Phase boundaries:

- Do not implement AI editing.
- Do not implement variants.
- Do not implement PDF upload or Marker.
- Do not add MinIO/S3.
- Do not deploy.

Important invariant:

- Preserve `page_count` anywhere compile results cross service or UI boundaries.
- Never solve overflow by truncating, clipping, or hiding content.

When reporting progress, include:

- Current task number and name.
- Files changed.
- Tests or commands run.
- Commit hash, if a commit was created.
