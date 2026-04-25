# HireScript

AI-first LaTeX resume maker. See `docs/plans/` for design and plans.

## Dev

```bash
cp .env.example .env  # then edit
docker compose up --build
```

- Frontend: http://localhost:5173
- API: http://localhost:8000
- MinIO console: http://localhost:9001 (compiled PDFs are stored here, keyed by `resume_versions.id`)

Run migrations after schema changes:

```bash
docker compose run --rm api alembic upgrade head
```

Run tests:

```bash
docker compose run --rm api pytest -v
docker compose run --rm web npm test -- --run
docker compose exec -T web npm run test:e2e
```

The live agent smoke test is gated behind `RUN_AGENT_SMOKE=1`. It needs `claude login` on the host (the api container bind-mounts `~/.claude`).

## Production deploy

See [`docs/deploy.md`](docs/deploy.md) for VPS bring-up with Caddy auto-HTTPS.
