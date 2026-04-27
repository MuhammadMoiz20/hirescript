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

### Knowledge base + onboarding

The mass-apply foundation introduces a personal knowledge base (master LaTeX,
manual markdown notes) and a chat-based onboarding agent.

Required env (in addition to the existing keys):

- `VOYAGE_API_KEY` — Voyage AI key used for KB chunk embeddings. Sign up at
  https://voyageai.com.

A new bind-mount `./kb` is available inside the api container at `/app/kb`.
Drop `*.md` files there and click "Sync" on the Knowledge page to ingest them.
The folder is gitignored (the `.gitkeep` is the only tracked file inside).

## Production deploy

See [`docs/deploy.md`](docs/deploy.md) for VPS bring-up with Caddy auto-HTTPS.
