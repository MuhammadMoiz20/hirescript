# HireScript — Deploying to a VPS

Single-tenant production deployment using Docker Compose + Caddy (auto-HTTPS via Let's Encrypt).

## Prereqs on the VPS

- Linux host, ports 80 + 443 open.
- DNS A record pointing your domain at the host's IP.
- Docker Engine + Docker Compose plugin.
- The `claude` CLI authenticated for the deploy user (see "Authenticate Claude" below).

## 1. Get the code

```bash
git clone https://github.com/MuhammadMoiz20/hirescript.git /srv/hirescript
cd /srv/hirescript
```

## 2. Authenticate Claude

The api container shells out to the local `claude` CLI and uses your Max
subscription. On the host:

```bash
sudo mkdir -p /srv/hirescript/.claude
# As the user that owns /srv/hirescript:
claude login
mv ~/.claude/* /srv/hirescript/.claude/   # if claude wrote elsewhere
```

(The compose file mounts `/srv/hirescript/.claude` into `/root/.claude` inside
the api container. Override the host path with `HIRESCRIPT_CLAUDE_DIR` in
`.env.prod` if needed.)

## 3. Configure secrets

```bash
cp .env.prod.example .env.prod
# Edit .env.prod — set HIRESCRIPT_DOMAIN, APP_PASSWORD, SESSION_SECRET,
# POSTGRES_PASSWORD, MINIO_ROOT_PASSWORD, STORAGE_SECRET_KEY.
chmod 600 .env.prod
```

## 4. Bring it up

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Caddy will request a Let's Encrypt cert for `HIRESCRIPT_DOMAIN` automatically.
Watch logs: `docker compose -f docker-compose.prod.yml logs -f caddy api`.

## 5. Run migrations on first boot

```bash
docker compose -f docker-compose.prod.yml run --rm api alembic upgrade head
```

## 6. Verify

- Visit `https://${HIRESCRIPT_DOMAIN}` — HireScript loads.
- Log in with `APP_PASSWORD`.
- Create a resume, edit, compile — PDF renders.
- MinIO console (port 9001) is **not** exposed to the internet by default.

## Updates

```bash
cd /srv/hirescript
git pull
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml run --rm api alembic upgrade head
```

## Backups

Two volumes hold all persistent state:

- `pgdata` — Postgres database.
- `miniodata` — compiled PDFs (one per `resume_versions.id`).

A simple nightly backup:

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > /backups/db-$(date +%F).sql.gz
docker run --rm -v hirescript_miniodata:/data -v /backups:/out alpine \
  tar czf /out/minio-$(date +%F).tar.gz -C /data .
```
