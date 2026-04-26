# Background Jobs & Mass-Apply Tailoring — Design

**Date:** 2026-04-25
**Status:** Approved (design); implementation plan to follow.

## Problem

Tailoring a resume against a JD takes 10–60 seconds and currently runs inline via SSE in `POST /resumes/{id}/tailor`. The user cannot queue many tailors in parallel ("mass apply" against a list of JDs), cannot close the tab and come back, and loses progress if the API restarts mid-run.

## Goals

- Kick off N tailor jobs in parallel against many JDs, then walk away.
- Survive API/worker restarts without losing in-flight work.
- A unified Jobs page + topbar badge surfaces queue state from anywhere in the app.
- Keep the existing single-tailor modal UX (live phase progress) by routing it through the new system.

## Non-goals (explicit)

- Scheduled / recurring jobs (cron). Punted to a later plan.
- Generic retry-with-backoff for arbitrary external calls. Tailor is non-idempotent; default `max_attempts=1`.
- Horizontal scale-out of workers. The claim mechanism supports it; we ship one worker container.
- Multi-tenant ownership of jobs. Single-tenant; all jobs belong to user 1.

## Architecture

A new `worker` service in `docker-compose.yml`, same image as `api`, different entrypoint (`python -m app.worker`). It connects to the same Postgres, imports the same `app.services.tailor` code, and runs an asyncio supervisor that maintains up to `WORKER_CONCURRENCY=4` (env-tunable) in-flight jobs.

```
┌─────────┐    POST /jobs (create rows)     ┌──────────┐
│   web   │ ──────────────────────────────► │   api    │
│         │ ◄── SSE GET /jobs/{id}/events ──│          │
└─────────┘                                 └────┬─────┘
                                                 │ writes/reads
                                                 ▼
                                           ┌──────────┐
                                           │ postgres │ ◄── claim/update/event-insert
                                           └────┬─────┘
                                                ▲
                                                │
                                          ┌─────┴────┐
                                          │  worker  │  (4 concurrent tailor coroutines)
                                          └──────────┘
```

Properties:

- API only enqueues and reads; never executes a tailor.
- Worker is the only writer of job status transitions and events.
- SSE in the API tails `job_events` by `job_id` (poll every ~500ms). LISTEN/NOTIFY is a possible upgrade if it feels laggy.
- Restart-safe: worker boot scans for `running` rows whose `heartbeat_at` is older than 60s and re-queues them.

## Queue mechanism

Hand-rolled Postgres queue using `SELECT ... FOR UPDATE SKIP LOCKED`. No Redis, no third-party queue library. Rationale: Postgres is already in the stack, the surface area is ~150 LOC, and we keep job creation transactional with business writes.

## Data model

Two new tables, async SQLAlchemy + Alembic migration.

### `jobs`

| column | type | notes |
|---|---|---|
| `id` | `uuid` PK | |
| `kind` | `text` | `"tailor"` for now; future-proof |
| `status` | `text` | `queued` / `running` / `succeeded` / `failed` / `cancelled` |
| `payload` | `jsonb` | `{resume_id, jd_id, model, deep}` |
| `result` | `jsonb` nullable | `{version_id, page_count}` on success; `{error}` on failure |
| `batch_id` | `uuid` nullable | groups a mass-apply submission |
| `attempts` | `int` default 0 | |
| `max_attempts` | `int` default 1 | tailor is non-idempotent → no auto-retry |
| `worker_id` | `text` nullable | which worker owns it |
| `heartbeat_at` | `timestamptz` nullable | refreshed every 10s while running |
| `created_at` / `started_at` / `finished_at` | `timestamptz` | |

Index: `(status, created_at)` for the claim query.

### `job_events`

| column | type | notes |
|---|---|---|
| `id` | `bigserial` PK | monotonic; SSE uses this as cursor |
| `job_id` | `uuid` FK → `jobs.id` | indexed |
| `created_at` | `timestamptz` | |
| `phase` | `text` | reuses existing tailor phase names |
| `message` | `text` nullable | |
| `data` | `jsonb` nullable | structured progress |

Two tables because events are append-only/high-volume while jobs is slow-changing source of truth. SSE: `SELECT * FROM job_events WHERE job_id = $1 AND id > $cursor`.

### Cancellation

API sets `status='cancelled'`. Worker checks status between phases and bails. No mid-Anthropic-call kill (YAGNI).

### Batch

`batch_id` ties N jobs together so the Jobs page can group "mass apply on 2026-04-25, 17/20 done."

## Worker loop

`app/worker.py` entrypoint:

```python
async def main():
    worker_id = f"worker-{uuid4()}"
    sem = asyncio.Semaphore(settings.WORKER_CONCURRENCY)
    await reclaim_stale_jobs()  # on boot
    while not shutdown.is_set():
        await sem.acquire()
        job = await claim_one(worker_id)   # SKIP LOCKED
        if job is None:
            sem.release()
            await asyncio.sleep(1.0)
            continue
        asyncio.create_task(run_job(job, worker_id, sem))
```

- **Claim**: `UPDATE jobs SET status='running', worker_id=$1, started_at=now(), heartbeat_at=now() WHERE id = (SELECT id FROM jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`.
- **Heartbeat**: sidecar coroutine per running job updates `heartbeat_at` every 10s.
- **Reclaim**: on boot, any `running` row whose `heartbeat_at < now() - 60s` flips back to `queued`.
- **Dispatch**: `kind='tailor'` → `run_tailor_job(payload, emit_event)`. The existing `tailor.py` SSE phases get rewired to call `emit_event(phase, message, data)` instead of yielding to a generator.
- **Cancellation**: between every phase, re-read `status`; if `cancelled`, raise and finalize.
- **Graceful shutdown**: SIGTERM sets `shutdown`; in-flight jobs finish, queue stops being drained.

## API surface

New router `app/routes/jobs.py`:

| method | path | purpose |
|---|---|---|
| `POST` | `/api/jobs/tailor` | body: `{resume_id, jd_ids: [...], model?, deep?}` → creates N rows in one transaction with shared `batch_id`, returns `{batch_id, job_ids}` |
| `GET` | `/api/jobs` | list, filter by status/batch, paginate |
| `GET` | `/api/jobs/{id}` | single job detail |
| `GET` | `/api/jobs/{id}/events` | SSE; `?cursor=<event_id>` for resume; sends `data` events with `{phase, message, data}` and a terminal `done` event |
| `POST` | `/api/jobs/{id}/cancel` | sets `cancelled` if `queued` or `running` |

The existing `POST /resumes/{id}/tailor` becomes a thin wrapper: enqueue a single-job batch and stream from `/api/jobs/{job_id}/events`. The current modal keeps working unchanged.

## Frontend

- **`/jobs` route** — table grouped by `batch_id`, newest first. Columns: JD title, status pill, phase progress, elapsed, result link (→ resume version) / error. Failed rows have a Retry button (creates a fresh job from the same payload). Polls `/api/jobs?status=running` every 2s for live updates (simpler than a global SSE).
- **Topbar badge** — small pill showing `running + queued`. Hidden at 0. Click → `/jobs`. Polls `/api/jobs?status=queued,running&count=true` every 5s.
- **Mass-apply entry** — JD list (`/jds`) gets multi-select checkboxes + a "Tailor against…" action that opens a resume picker → `POST /api/jobs/tailor` → navigates to `/jobs?batch=<id>` with the new batch highlighted.
- **Tailor modal** — unchanged UX, but its SSE source changes to `/api/jobs/{id}/events`.

## Testing

- **Unit**: `claim_one` (10 concurrent claims against 1 row, exactly one wins); `reclaim_stale_jobs`; cancellation propagation; retry-from-failed.
- **Integration**: start `worker.main()` as a task in-test, enqueue a tailor job, assert `queued → running → succeeded`, version + events written. Reuse existing tailor test doubles for Anthropic.
- **Route**: `POST /api/jobs/tailor` with 3 `jd_ids` creates 3 jobs sharing a batch. SSE endpoint streams events and terminates on `done`.
- **Frontend**: Jobs page renders all status states; topbar badge shows count; multi-select on JD list enqueues correctly. Vitest + RTL.

## Configuration

- `WORKER_CONCURRENCY` (env, default `4`) — max in-flight jobs per worker container.
- `WORKER_HEARTBEAT_SEC` (default `10`) and `WORKER_RECLAIM_AFTER_SEC` (default `60`).

## Migration / rollout

Single Alembic revision adds both tables. The existing `/resumes/{id}/tailor` is rewritten to enqueue + redirect to job SSE in the same change; no parallel old/new path.
