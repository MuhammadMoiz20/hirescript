# Phase 6 — MinIO Object Storage + VPS Deployment

> **For Claude:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`.

**Goal:** Move compiled PDFs from a local Docker volume into MinIO (S3-compatible) keyed by `resume_version.id`, and produce a deployable docker-compose setup with Caddy as the HTTPS reverse proxy.

**Anchor:** design doc — "Stack" (MinIO local / S3 prod), "Object storage", "Deploy".

**Scope:**
- MinIO local service in dev compose; an `ObjectStorage` abstraction in api with a single S3 backend (MinIO is S3-compatible).
- New `compiled_pdf_key` column on `resume_versions` (Alembic 0005).
- Snapshot helper writes the PDF to storage and records the key (when a PDF is available).
- New endpoint `GET /resumes/{id}/versions/{vid}/pdf` → 302 to a presigned URL (or stream bytes if presigning is unavailable).
- Production `docker-compose.prod.yml` with Caddy + on-host data volumes.
- `Caddyfile` with HTTPS automatic certs.
- `docs/deploy.md` with VPS bring-up steps.

**Out of scope:** Real-S3 deployment (we configure the backend so MinIO and S3 are interchangeable, but only test against MinIO). CDN / multi-region.

---

## Task 1: MinIO compose service + boto3 dep

**Files:**
- Modify: `docker-compose.yml` — add `minio` service.
- Modify: `.env.example` — add `MINIO_*` vars.
- Modify: `api/pyproject.toml` — add `boto3==1.35.*`.
- Modify: `api/app/config.py` — add settings for the storage layer.

`minio` service:
```yaml
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
    ports: ["9000:9000", "9001:9001"]
    volumes: [miniodata:/data]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/ready"]
      interval: 5s
      timeout: 3s
      retries: 10
```

Add `miniodata:` to `volumes:` and add MinIO as a dependency of `api` (depends_on with health-check condition).

Settings additions:
```python
storage_endpoint_url: str = "http://minio:9000"
storage_access_key: str = "minio"
storage_secret_key: str = "minio12345"
storage_bucket: str = "hirescript-pdfs"
storage_region: str = "us-east-1"
```

Bucket auto-create at app startup if missing.

**Commit:** `feat(api): minio service + boto3 storage settings`

---

## Task 2: ObjectStorage service + bucket bootstrap

**Files:**
- Create: `api/app/services/storage.py`
- Create: `api/tests/test_storage.py`

API:
```python
def put_pdf(*, key: str, data: bytes) -> None
def get_pdf(*, key: str) -> bytes
def presign_get(*, key: str, ttl_seconds: int = 600) -> str
def ensure_bucket() -> None
```

Use boto3 `client("s3", endpoint_url=..., region_name=..., access_key=..., secret_key=...)`. Tests run against a real MinIO instance (the `minio` service must be up). Use a unique bucket per test run (e.g., `hirescript-test-<uuid>`) and clean up after.

Wire `ensure_bucket()` into `app/main.py` lifespan so the default bucket exists on startup.

**Commit:** `feat(api): object storage service`

---

## Task 3: `compiled_pdf_key` column + snapshot integration

**Files:**
- Modify: `api/app/models.py` (add `compiled_pdf_key: Mapped[str | None]` on `ResumeVersion`)
- Create: `api/alembic/versions/0005_resume_version_pdf_key.py`
- Modify: `api/app/services/versioning.py` — accept optional `pdf_bytes`; when provided, write to storage with key `versions/<id>.pdf` and store the key. We need the version id first → flush, derive key, put, then commit.
- Modify: `api/app/routes/resumes.py` — pass `pdf_bytes` for the paths that have it (accept_edit, sections_put, tailor, onboard).
- Modify: `api/tests/test_version_snapshots.py` — assert `compiled_pdf_key` set when a pdf_bytes is provided.

**Commit:** `feat(api): persist compiled pdf to storage on snapshot`

---

## Task 4: Version PDF endpoint

**Files:**
- Modify: `api/app/routes/versions.py` — add `GET /resumes/{id}/versions/{vid}/pdf` that 302s to a presigned URL when `compiled_pdf_key` exists; 404 otherwise.
- Modify: `api/tests/test_versions_endpoints.py` — add a test that creates a version with a PDF and asserts the redirect target contains the bucket and key.

**Commit:** `feat(api): version pdf signed-url endpoint`

---

## Task 5: Production docker-compose + Caddy

**Files:**
- Create: `docker-compose.prod.yml`
- Create: `Caddyfile`
- Create: `.env.prod.example`
- Create: `docs/deploy.md`

`docker-compose.prod.yml`:
- `db` (Postgres) with named volume + healthcheck.
- `minio` with named volume + console exposed only inside the docker network.
- `api` built from `./api`, no source bind mount, env from `.env.prod`. `claude` CLI auth mounts `/srv/hirescript/.claude` to `/root/.claude`.
- `web` built from `./web` for production: change Dockerfile to also produce a `/app/dist` static build OR use a multi-stage `node:20-slim` → `caddy` static serve. Simplest: `web` runs `vite build` and a tiny `serve` step OR Caddy serves the dist folder.
- `caddy` exposes 80/443. Reverse-proxies `/api/*` to `api:8000` (rewrites prefix off) and serves the SPA from `web/dist`.

`Caddyfile`:
```
{$HIRESCRIPT_DOMAIN} {
  encode zstd gzip
  handle_path /api/* {
    reverse_proxy api:8000
  }
  handle {
    root * /srv/web
    try_files {path} /index.html
    file_server
  }
}
```

(`{$HIRESCRIPT_DOMAIN}` resolves via env at boot; auto-HTTPS via Let's Encrypt.)

`docs/deploy.md`: VPS bring-up (Docker install, clone repo, copy `.env.prod`, run `claude login` once, `docker compose -f docker-compose.prod.yml up -d`, point DNS).

No new tests. Smoke is manual.

**Commit:** `feat(infra): production compose + caddy reverse proxy`

---

## Task 6: README updates

Document the dev compose addition (MinIO console at http://localhost:9001), the `MINIO_*` env vars, and link to `docs/deploy.md` for prod.

**Commit:** `docs: minio + deploy notes in README`

---

## Done criteria

- API: 106 + ~3 storage tests + ~1 endpoint test pass.
- Local dev: `docker compose up` shows db/api/web/minio healthy; PDF artifacts persist to MinIO (visible in console).
- `docker compose -f docker-compose.prod.yml config` validates.
- A Caddyfile exists that would serve a real domain when DNS points at the host.

Next plan: `2026-04-XX-overflow-banner.md`.
