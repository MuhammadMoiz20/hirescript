# HireScript Walking Skeleton Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stand up the thinnest end-to-end slice — a logged-in user can create a resume from a built-in template, edit its raw LaTeX, compile it with Tectonic, and see the PDF preview. No AI, no variants, no PDF upload yet.

**Architecture:** Docker Compose with three services — `web` (React + Vite), `api` (FastAPI), `db` (Postgres). Tectonic is installed in the `api` image and shelled out to via subprocess. Auth is a single server-side password checked against an env var, with a signed session cookie. Compiled PDFs are written to a local volume in dev (MinIO comes in a later plan).

**Tech Stack:** React 18 + Vite + TypeScript, CodeMirror 6, pdfjs-dist, FastAPI, SQLAlchemy 2.x + Alembic, Pydantic v2, asyncpg, Postgres 16, Tectonic (latest), Docker Compose, pytest, Vitest, Playwright.

**Follow-up plans (not in this document):**
1. `claude-agent-sdk` integration + chat sidebar + diff UI + **one-page overflow-repair loop** (`OnePageEnforcer` service, protected-terms list, iterative re-prompt on `page_count != 1`). See design doc "The One-Page Constraint" section — this is where the constraint is enforced end-to-end.
2. "Tailor to JD" preset + `job_descriptions` table + variants (JD-derived protected terms feed into the enforcer).
3. Section form editor + LaTeX ↔ JSON parser per template
4. PDF onboarding (Marker + template mapping)
5. Version history + rollback (store `page_count` on each version)
6. MinIO + VPS deployment with Caddy
7. Manual-edit page-overflow banner + one-click "Ask Claude to tighten"

---

## Task 1: Repo scaffold

**Files:**
- Create: `.gitignore`
- Create: `README.md`
- Create: `docker-compose.yml`
- Create: `.env.example`

**Step 1: Write `.gitignore`**

```
# Python
__pycache__/
*.pyc
.venv/
.pytest_cache/
.mypy_cache/

# Node
node_modules/
dist/
.vite/

# Env
.env
.env.local

# Build artifacts
api/compiled_pdfs/
*.log

# OS
.DS_Store
```

**Step 2: Write minimal `README.md`**

```markdown
# HireScript

AI-first LaTeX resume maker. See `docs/plans/` for design and plans.

## Dev

```bash
cp .env.example .env  # then edit
docker compose up --build
```

Frontend: http://localhost:5173
API: http://localhost:8000
```

**Step 3: Write `.env.example`**

```
# Required
APP_PASSWORD=changeme
SESSION_SECRET=generate-a-long-random-string
DATABASE_URL=postgresql+asyncpg://hirescript:hirescript@db:5432/hirescript
POSTGRES_USER=hirescript
POSTGRES_PASSWORD=hirescript
POSTGRES_DB=hirescript
```

**Step 4: Write `docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 5s
      timeout: 3s
      retries: 10

  api:
    build: ./api
    env_file: .env
    ports: ["8000:8000"]
    volumes:
      - ./api:/app
      - pdfs:/app/compiled_pdfs
    depends_on:
      db:
        condition: service_healthy

  web:
    build: ./web
    ports: ["5173:5173"]
    volumes:
      - ./web:/app
      - /app/node_modules
    depends_on: [api]

volumes:
  pgdata:
  pdfs:
```

**Step 5: Commit**

```bash
git add .gitignore README.md docker-compose.yml .env.example
git commit -m "chore: scaffold monorepo and docker compose"
```

---

## Task 2: FastAPI skeleton with health check

**Files:**
- Create: `api/Dockerfile`
- Create: `api/pyproject.toml`
- Create: `api/app/__init__.py`
- Create: `api/app/main.py`
- Create: `api/app/config.py`
- Create: `api/tests/__init__.py`
- Create: `api/tests/test_health.py`

**Step 1: Write the failing test** in `api/tests/test_health.py`

```python
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health_returns_ok():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

**Step 2: Write `api/pyproject.toml`**

```toml
[project]
name = "hirescript-api"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi==0.115.*",
    "uvicorn[standard]==0.32.*",
    "pydantic==2.9.*",
    "pydantic-settings==2.6.*",
    "sqlalchemy==2.0.*",
    "asyncpg==0.30.*",
    "alembic==1.14.*",
    "itsdangerous==2.2.*",
    "python-multipart==0.0.*",
]

[project.optional-dependencies]
dev = ["pytest==8.*", "pytest-asyncio==0.24.*", "httpx==0.27.*"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
```

**Step 3: Write `api/Dockerfile`**

```dockerfile
FROM python:3.12-slim

# Tectonic — single binary
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
 && curl --proto '=https' --tlsv1.2 -fsSL https://drop-sh.fullyjustified.net \
    | sh \
 && mv tectonic /usr/local/bin/ \
 && apt-get remove -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml .
RUN pip install --no-cache-dir -e ".[dev]"

COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
```

**Step 4: Write `api/app/config.py`**

```python
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    app_password: str
    session_secret: str
    database_url: str

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
```

**Step 5: Write `api/app/main.py`**

```python
from fastapi import FastAPI

app = FastAPI(title="HireScript API")

@app.get("/health")
def health():
    return {"status": "ok"}
```

**Step 6: Run the test**

```bash
docker compose run --rm api pytest tests/test_health.py -v
```

Expected: PASS.

**Step 7: Commit**

```bash
git add api/
git commit -m "feat(api): FastAPI skeleton with health check and tectonic image"
```

---

## Task 3: Database, SQLAlchemy setup, Alembic migration for users + resumes

**Files:**
- Create: `api/app/db.py`
- Create: `api/app/models.py`
- Create: `api/alembic.ini`
- Create: `api/alembic/env.py`
- Create: `api/alembic/script.py.mako`
- Create: `api/alembic/versions/0001_initial.py`
- Create: `api/tests/test_models.py`

**Step 1: Write the failing test** in `api/tests/test_models.py`

```python
import pytest
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.models import Base, User, Resume

@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    SessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with SessionLocal() as s:
        yield s

async def test_can_create_user_and_resume(session):
    user = User(id=1)
    session.add(user)
    await session.flush()
    resume = Resume(user_id=1, kind="master", name="Master", template_id="jakes", latex_source="...")
    session.add(resume)
    await session.commit()
    assert resume.id is not None
```

(Add `aiosqlite` to dev deps in pyproject.toml.)

**Step 2: Write `api/app/models.py`**

```python
from datetime import datetime
from sqlalchemy import String, Text, ForeignKey, DateTime, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    resumes: Mapped[list["Resume"]] = relationship(back_populates="user")

class Resume(Base):
    __tablename__ = "resumes"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("resumes.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(16))  # master | variant
    name: Mapped[str] = mapped_column(String(200))
    template_id: Mapped[str] = mapped_column(String(64))
    latex_source: Mapped[str] = mapped_column(Text)
    content_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    user: Mapped[User] = relationship(back_populates="resumes")
```

**Step 3: Write `api/app/db.py`**

```python
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.config import settings

engine = create_async_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def get_db():
    async with SessionLocal() as session:
        yield session
```

**Step 4: Initialize Alembic**

Run: `docker compose run --rm api alembic init alembic`

Then overwrite `api/alembic/env.py` to use `app.models.Base.metadata` and `settings.database_url` (sync driver for migrations — replace `+asyncpg` with empty).

**Step 5: Generate migration**

Run: `docker compose run --rm api alembic revision --autogenerate -m "initial"`

Verify the generated file creates `users` and `resumes`.

**Step 6: Apply migration**

Run: `docker compose run --rm api alembic upgrade head`

**Step 7: Run the model test**

Run: `docker compose run --rm api pytest tests/test_models.py -v`
Expected: PASS.

**Step 8: Commit**

```bash
git add api/
git commit -m "feat(api): db models, alembic, users+resumes tables"
```

---

## Task 4: Seed single built-in template (Jake's Resume)

**Files:**
- Create: `api/app/templates/__init__.py`
- Create: `api/app/templates/jakes.py`
- Create: `api/app/templates/jakes_skeleton.tex`
- Create: `api/tests/test_templates.py`

**Step 1: Write the failing test**

```python
from app.templates import get_template, list_templates

def test_jakes_template_is_registered():
    ids = [t["id"] for t in list_templates()]
    assert "jakes" in ids

def test_get_template_returns_latex_skeleton():
    tpl = get_template("jakes")
    assert tpl["id"] == "jakes"
    assert "\\documentclass" in tpl["latex_skeleton"]
```

**Step 2: Save Jake's Resume template**

The template file `api/app/templates/jakes_skeleton.tex` is pre-seeded in the repo with the user's master resume (Muhammad Moiz). It uses Jake's Resume LaTeX structure (`\resumeSubheading`, `\resumeItemListStart`, etc.) with concrete content already filled in. Do not overwrite it or strip content — use it as-is.

**Step 3: Write `api/app/templates/jakes.py`**

```python
from pathlib import Path

_SKELETON = (Path(__file__).parent / "jakes_skeleton.tex").read_text()

JAKES = {
    "id": "jakes",
    "name": "Jake's Resume",
    "latex_skeleton": _SKELETON,
}
```

**Step 4: Write `api/app/templates/__init__.py`**

```python
from .jakes import JAKES

_REGISTRY = {JAKES["id"]: JAKES}

def list_templates():
    return [{"id": t["id"], "name": t["name"]} for t in _REGISTRY.values()]

def get_template(template_id: str):
    return _REGISTRY[template_id]
```

**Step 5: Run the test**

Run: `docker compose run --rm api pytest tests/test_templates.py -v`
Expected: PASS.

**Step 6: Commit**

```bash
git add api/app/templates/ api/tests/test_templates.py
git commit -m "feat(api): register Jake's Resume template"
```

---

## Task 5: Tectonic compile service

The compile service is where the one-page constraint enters the stack. Page count is a first-class return value from day one so later AI plans (overflow-repair loop) can depend on it without refactoring.

**Files:**
- Create: `api/app/services/compile.py`
- Create: `api/tests/test_compile.py`
- Modify: `api/pyproject.toml` (add `pypdf`)

**Step 1: Add `pypdf==5.*` to `pyproject.toml` dependencies.**

**Step 2: Write the failing test**

```python
from app.services.compile import compile_latex, CompileError, CompileResult

MINIMAL_DOC = r"""
\documentclass{article}
\begin{document}
Hello HireScript.
\end{document}
"""

def test_compile_returns_pdf_bytes_and_page_count():
    result = compile_latex(MINIMAL_DOC)
    assert isinstance(result, CompileResult)
    assert result.pdf[:4] == b"%PDF"
    assert result.page_count == 1

def test_compile_detects_multi_page():
    doc = r"""
    \documentclass{article}
    \begin{document}
    """ + ("Filler paragraph. " * 2000) + r"""
    \end{document}
    """
    result = compile_latex(doc)
    assert result.page_count >= 2

def test_compile_raises_on_invalid_latex():
    import pytest
    with pytest.raises(CompileError):
        compile_latex(r"\documentclass{article}\begin{document}\unknowncmd\end{document}")
```

**Step 3: Write `api/app/services/compile.py`**

```python
import io
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from pypdf import PdfReader

class CompileError(RuntimeError):
    def __init__(self, stderr: str):
        super().__init__(stderr)
        self.stderr = stderr

@dataclass(frozen=True)
class CompileResult:
    pdf: bytes
    page_count: int

def compile_latex(source: str, timeout: int = 30) -> CompileResult:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        tex_file = tmp_path / "doc.tex"
        tex_file.write_text(source)
        result = subprocess.run(
            ["tectonic", "-X", "compile", "--outdir", str(tmp_path), str(tex_file)],
            capture_output=True, text=True, timeout=timeout,
        )
        if result.returncode != 0:
            raise CompileError(result.stderr or result.stdout)
        pdf_path = tmp_path / "doc.pdf"
        if not pdf_path.exists():
            raise CompileError("PDF not produced")
        pdf_bytes = pdf_path.read_bytes()
        page_count = len(PdfReader(io.BytesIO(pdf_bytes)).pages)
        return CompileResult(pdf=pdf_bytes, page_count=page_count)
```

Note: at this walking-skeleton stage we *report* page count but do not yet enforce `page_count == 1` — enforcement belongs to the AI-edit plan where the overflow-repair loop lives. Manual-edit flows will gain a UI warning in a later task. See the design doc's "One-Page Constraint" section.

**Step 3: Run the test**

Run: `docker compose run --rm api pytest tests/test_compile.py -v`
Expected: PASS (Tectonic may download packages on first run — allow ~60s).

**Step 4: Commit**

```bash
git add api/app/services/compile.py api/tests/test_compile.py
git commit -m "feat(api): tectonic compile service"
```

---

## Task 6: Auth (single password + signed session cookie)

**Files:**
- Create: `api/app/auth.py`
- Create: `api/app/routes/auth.py`
- Modify: `api/app/main.py`
- Create: `api/tests/test_auth.py`

**Step 1: Write the failing test**

```python
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_login_with_correct_password_sets_cookie():
    r = client.post("/auth/login", json={"password": "changeme"})
    assert r.status_code == 200
    assert "session" in r.cookies

def test_login_with_wrong_password_rejected():
    r = client.post("/auth/login", json={"password": "nope"})
    assert r.status_code == 401

def test_protected_route_requires_cookie():
    r = client.get("/auth/me")
    assert r.status_code == 401

def test_protected_route_works_with_cookie():
    login = client.post("/auth/login", json={"password": "changeme"})
    r = client.get("/auth/me", cookies=login.cookies)
    assert r.status_code == 200
    assert r.json() == {"user_id": 1}
```

(Set `APP_PASSWORD=changeme` in the test env via `conftest.py`.)

**Step 2: Write `api/app/auth.py`**

```python
from itsdangerous import URLSafeSerializer, BadSignature
from fastapi import Request, HTTPException, Depends
from app.config import settings

_serializer = URLSafeSerializer(settings.session_secret, salt="session")
SESSION_COOKIE = "session"

def issue_session(user_id: int) -> str:
    return _serializer.dumps({"user_id": user_id})

def read_session(token: str) -> int:
    try:
        data = _serializer.loads(token)
        return int(data["user_id"])
    except (BadSignature, KeyError, ValueError) as e:
        raise HTTPException(status_code=401, detail="invalid session") from e

def require_user(request: Request) -> int:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="not logged in")
    return read_session(token)
```

**Step 3: Write `api/app/routes/auth.py`**

```python
from fastapi import APIRouter, Response, HTTPException, Depends
from pydantic import BaseModel
from app.auth import issue_session, require_user, SESSION_COOKIE
from app.config import settings

router = APIRouter(prefix="/auth")

class LoginRequest(BaseModel):
    password: str

@router.post("/login")
def login(body: LoginRequest, response: Response):
    if body.password != settings.app_password:
        raise HTTPException(status_code=401, detail="wrong password")
    token = issue_session(user_id=1)
    response.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="lax")
    return {"ok": True}

@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE)
    return {"ok": True}

@router.get("/me")
def me(user_id: int = Depends(require_user)):
    return {"user_id": user_id}
```

**Step 4: Wire router in `api/app/main.py`**

```python
from fastapi import FastAPI
from app.routes import auth

app = FastAPI(title="HireScript API")
app.include_router(auth.router)

@app.get("/health")
def health():
    return {"status": "ok"}
```

**Step 5: Bootstrap the single user on startup**

Add to `api/app/main.py`:

```python
from contextlib import asynccontextmanager
from sqlalchemy import select
from app.db import SessionLocal
from app.models import User

@asynccontextmanager
async def lifespan(app):
    async with SessionLocal() as s:
        existing = await s.execute(select(User).where(User.id == 1))
        if existing.scalar_one_or_none() is None:
            s.add(User(id=1))
            await s.commit()
    yield

app = FastAPI(title="HireScript API", lifespan=lifespan)
```

**Step 6: Run the test**

Run: `docker compose run --rm api pytest tests/test_auth.py -v`
Expected: PASS.

**Step 7: Commit**

```bash
git add api/
git commit -m "feat(api): single-password auth with signed session cookie"
```

---

## Task 7: Resume CRUD endpoints

**Files:**
- Create: `api/app/routes/resumes.py`
- Create: `api/app/schemas.py`
- Modify: `api/app/main.py`
- Create: `api/tests/test_resumes.py`

**Step 1: Write failing tests**

```python
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def _login():
    return client.post("/auth/login", json={"password": "changeme"}).cookies

def test_create_resume_from_template():
    cookies = _login()
    r = client.post("/resumes", json={"name": "My Resume", "template_id": "jakes"}, cookies=cookies)
    assert r.status_code == 201
    assert r.json()["name"] == "My Resume"
    assert "\\documentclass" in r.json()["latex_source"]

def test_list_resumes():
    cookies = _login()
    client.post("/resumes", json={"name": "R1", "template_id": "jakes"}, cookies=cookies)
    r = client.get("/resumes", cookies=cookies)
    assert r.status_code == 200
    assert len(r.json()) >= 1

def test_get_resume():
    cookies = _login()
    created = client.post("/resumes", json={"name": "R2", "template_id": "jakes"}, cookies=cookies).json()
    r = client.get(f"/resumes/{created['id']}", cookies=cookies)
    assert r.status_code == 200

def test_update_resume_latex():
    cookies = _login()
    created = client.post("/resumes", json={"name": "R3", "template_id": "jakes"}, cookies=cookies).json()
    r = client.put(f"/resumes/{created['id']}", json={"latex_source": "\\documentclass{article}\\begin{document}x\\end{document}"}, cookies=cookies)
    assert r.status_code == 200

def test_endpoints_require_auth():
    r = client.get("/resumes")
    assert r.status_code == 401
```

**Step 2: Write `api/app/schemas.py`**

```python
from pydantic import BaseModel
from datetime import datetime

class ResumeCreate(BaseModel):
    name: str
    template_id: str

class ResumeUpdate(BaseModel):
    name: str | None = None
    latex_source: str | None = None

class ResumeOut(BaseModel):
    id: int
    name: str
    template_id: str
    kind: str
    latex_source: str
    updated_at: datetime

    model_config = {"from_attributes": True}
```

**Step 3: Write `api/app/routes/resumes.py`**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import require_user
from app.db import get_db
from app.models import Resume
from app.schemas import ResumeCreate, ResumeUpdate, ResumeOut
from app.templates import get_template

router = APIRouter(prefix="/resumes")

@router.post("", response_model=ResumeOut, status_code=201)
async def create_resume(body: ResumeCreate, user_id: int = Depends(require_user), db: AsyncSession = Depends(get_db)):
    try:
        tpl = get_template(body.template_id)
    except KeyError:
        raise HTTPException(404, "unknown template")
    resume = Resume(user_id=user_id, kind="master", name=body.name, template_id=body.template_id, latex_source=tpl["latex_skeleton"])
    db.add(resume)
    await db.commit()
    await db.refresh(resume)
    return resume

@router.get("", response_model=list[ResumeOut])
async def list_resumes(user_id: int = Depends(require_user), db: AsyncSession = Depends(get_db)):
    rows = await db.execute(select(Resume).where(Resume.user_id == user_id).order_by(Resume.updated_at.desc()))
    return rows.scalars().all()

@router.get("/{resume_id}", response_model=ResumeOut)
async def get_resume(resume_id: int, user_id: int = Depends(require_user), db: AsyncSession = Depends(get_db)):
    r = await db.get(Resume, resume_id)
    if r is None or r.user_id != user_id:
        raise HTTPException(404)
    return r

@router.put("/{resume_id}", response_model=ResumeOut)
async def update_resume(resume_id: int, body: ResumeUpdate, user_id: int = Depends(require_user), db: AsyncSession = Depends(get_db)):
    r = await db.get(Resume, resume_id)
    if r is None or r.user_id != user_id:
        raise HTTPException(404)
    if body.name is not None:
        r.name = body.name
    if body.latex_source is not None:
        r.latex_source = body.latex_source
    await db.commit()
    await db.refresh(r)
    return r
```

**Step 4: Wire router in `api/app/main.py`**

Add `from app.routes import resumes` and `app.include_router(resumes.router)`.

**Step 5: Run the test**

Run: `docker compose run --rm api pytest tests/test_resumes.py -v`
Expected: PASS.

**Step 6: Commit**

```bash
git add api/
git commit -m "feat(api): resume CRUD endpoints"
```

---

## Task 8: Compile endpoint

**Files:**
- Modify: `api/app/routes/resumes.py`
- Create: `api/tests/test_compile_endpoint.py`

**Step 1: Write failing test**

```python
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_compile_endpoint_returns_pdf():
    cookies = client.post("/auth/login", json={"password": "changeme"}).cookies
    created = client.post("/resumes", json={"name": "RC", "template_id": "jakes"}, cookies=cookies).json()
    r = client.post(f"/resumes/{created['id']}/compile", cookies=cookies)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content[:4] == b"%PDF"
```

**Step 2: Add the endpoint** to `api/app/routes/resumes.py`

```python
from fastapi.responses import Response
from app.services.compile import compile_latex, CompileError

@router.post("/{resume_id}/compile")
async def compile_resume(resume_id: int, user_id: int = Depends(require_user), db: AsyncSession = Depends(get_db)):
    r = await db.get(Resume, resume_id)
    if r is None or r.user_id != user_id:
        raise HTTPException(404)
    try:
        result = compile_latex(r.latex_source)
    except CompileError as e:
        raise HTTPException(422, detail={"error": "compile_failed", "log": str(e)[:4000]})
    return Response(
        content=result.pdf,
        media_type="application/pdf",
        headers={"X-Page-Count": str(result.page_count)},
    )
```

**Step 3: Run the test**

Run: `docker compose run --rm api pytest tests/test_compile_endpoint.py -v`
Expected: PASS.

**Step 4: Commit**

```bash
git add api/
git commit -m "feat(api): compile endpoint returning PDF"
```

---

## Task 9: Frontend scaffold (Vite + React + TS)

**Files:**
- Create: `web/Dockerfile`
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/api.ts`

**Step 1: Write `web/package.json`**

```json
{
  "name": "hirescript-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "tsc -b && vite build",
    "test": "vitest",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.27.0",
    "@codemirror/lang-stex": "^6.0.0",
    "@uiw/react-codemirror": "^4.23.0",
    "pdfjs-dist": "^4.7.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.5.0",
    "jsdom": "^25.0.0",
    "@playwright/test": "^1.48.0"
  }
}
```

**Step 2: Write `web/Dockerfile`**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]
```

**Step 3: Write `web/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": { target: "http://api:8000", rewrite: p => p.replace(/^\/api/, "") } },
  },
  test: { environment: "jsdom", globals: true },
});
```

**Step 4: Write `web/tsconfig.json`, `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`**

Standard Vite React TS scaffold. `App.tsx` for now:

```tsx
export default function App() {
  return <div>HireScript</div>;
}
```

**Step 5: Write `web/src/api.ts`**

```ts
const BASE = "/api";

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    ...init,
  });
  if (!res.ok) throw new Error(await res.text());
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : (res.blob() as unknown as T);
}

export const api = {
  login: (password: string) => req<{ ok: boolean }>("/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  me: () => req<{ user_id: number }>("/auth/me"),
  listResumes: () => req<Array<{ id: number; name: string; template_id: string; latex_source: string; updated_at: string }>>("/resumes"),
  createResume: (name: string, template_id: string) => req("/resumes", { method: "POST", body: JSON.stringify({ name, template_id }) }),
  getResume: (id: number) => req<{ id: number; name: string; latex_source: string }>(`/resumes/${id}`),
  updateResume: (id: number, latex_source: string) => req(`/resumes/${id}`, { method: "PUT", body: JSON.stringify({ latex_source }) }),
  compileResume: (id: number) => fetch(`${BASE}/resumes/${id}/compile`, { method: "POST", credentials: "include" }).then(r => r.ok ? r.blob() : r.json().then(j => Promise.reject(j))),
};
```

**Step 6: Verify**

Run: `docker compose up --build web`, visit http://localhost:5173, see "HireScript".

**Step 7: Commit**

```bash
git add web/
git commit -m "feat(web): vite+react+ts scaffold with api client"
```

---

## Task 10: Login page

**Files:**
- Create: `web/src/routes/Login.tsx`
- Modify: `web/src/App.tsx`
- Create: `web/src/routes/Login.test.tsx`

**Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Login from "./Login";
import { vi } from "vitest";

vi.mock("../api", () => ({ api: { login: vi.fn().mockResolvedValue({ ok: true }) } }));

test("submits password and calls api.login", async () => {
  const { api } = await import("../api");
  render(<Login onSuccess={() => {}} />);
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "secret" } });
  fireEvent.click(screen.getByRole("button", { name: /log in/i }));
  await waitFor(() => expect(api.login).toHaveBeenCalledWith("secret"));
});
```

**Step 2: Write `web/src/routes/Login.tsx`**

```tsx
import { useState } from "react";
import { api } from "../api";

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try { await api.login(password); onSuccess(); }
    catch { setError("Invalid password"); }
  }
  return (
    <form onSubmit={submit}>
      <label>Password <input type="password" value={password} onChange={e => setPassword(e.target.value)} /></label>
      <button type="submit">Log in</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
```

**Step 3: Wire in `App.tsx` with simple auth state**

```tsx
import { useEffect, useState } from "react";
import Login from "./routes/Login";
import { api } from "./api";

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => { api.me().then(() => setAuthed(true)).catch(() => setAuthed(false)); }, []);
  if (authed === null) return <p>Loading…</p>;
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;
  return <div>Logged in (editor goes here)</div>;
}
```

**Step 4: Run the test**

Run: `docker compose run --rm web npm test -- --run`
Expected: PASS.

**Step 5: Commit**

```bash
git add web/
git commit -m "feat(web): login page and auth gate"
```

---

## Task 11: Resume list + create

**Files:**
- Create: `web/src/routes/ResumeList.tsx`
- Modify: `web/src/App.tsx` (route to list)
- Create: `web/src/routes/ResumeList.test.tsx`

**Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import ResumeList from "./ResumeList";
import { vi } from "vitest";

vi.mock("../api", () => ({
  api: {
    listResumes: vi.fn().mockResolvedValue([{ id: 1, name: "R1", template_id: "jakes", latex_source: "", updated_at: "" }]),
    createResume: vi.fn(),
  },
}));

test("renders the list", async () => {
  render(<ResumeList onOpen={() => {}} />);
  await waitFor(() => expect(screen.getByText("R1")).toBeInTheDocument());
});
```

**Step 2: Write `web/src/routes/ResumeList.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api } from "../api";

type Resume = { id: number; name: string; template_id: string; updated_at: string };

export default function ResumeList({ onOpen }: { onOpen: (id: number) => void }) {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [name, setName] = useState("");
  async function refresh() { setResumes(await api.listResumes()); }
  useEffect(() => { refresh(); }, []);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await api.createResume(name, "jakes");
    setName("");
    refresh();
  }
  return (
    <div>
      <h1>Resumes</h1>
      <form onSubmit={create}>
        <input placeholder="New resume name" value={name} onChange={e => setName(e.target.value)} />
        <button type="submit">Create from Jake's</button>
      </form>
      <ul>
        {resumes.map(r => <li key={r.id}><button onClick={() => onOpen(r.id)}>{r.name}</button></li>)}
      </ul>
    </div>
  );
}
```

**Step 3: Wire in App**

```tsx
const [openId, setOpenId] = useState<number | null>(null);
// in authed branch:
return openId === null
  ? <ResumeList onOpen={setOpenId} />
  : <Editor id={openId} onBack={() => setOpenId(null)} />;
```

(Add a stub `Editor` component that renders `<p>Editor {id}</p>` for now.)

**Step 4: Run the test**

Run: `docker compose run --rm web npm test -- --run`
Expected: PASS.

**Step 5: Commit**

```bash
git add web/
git commit -m "feat(web): resume list and create-from-template"
```

---

## Task 12: Raw LaTeX editor + PDF preview (the walking skeleton completes here)

**Files:**
- Create: `web/src/routes/Editor.tsx`
- Create: `web/src/components/PdfPreview.tsx`

**Step 1: Write `web/src/components/PdfPreview.tsx`**

```tsx
import { useEffect, useRef } from "react";
import * as pdfjs from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export default function PdfPreview({ pdfBlob }: { pdfBlob: Blob | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!pdfBlob || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      const buf = await pdfBlob.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: buf }).promise;
      const page = await pdf.getPage(1);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = canvasRef.current!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
    })();
    return () => { cancelled = true; };
  }, [pdfBlob]);
  if (!pdfBlob) return <p>Compile to see preview</p>;
  return <canvas ref={canvasRef} style={{ maxWidth: "100%", border: "1px solid #ccc" }} />;
}
```

**Step 2: Write `web/src/routes/Editor.tsx`**

```tsx
import { useEffect, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { api } from "../api";
import PdfPreview from "../components/PdfPreview";

export default function Editor({ id, onBack }: { id: number; onBack: () => void }) {
  const [latex, setLatex] = useState("");
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getResume(id).then(r => setLatex(r.latex_source));
  }, [id]);

  async function save() {
    setSaving(true);
    try { await api.updateResume(id, latex); } finally { setSaving(false); }
  }

  async function compile() {
    setError(null);
    try {
      await save();
      const blob = await api.compileResume(id);
      setPdf(blob as Blob);
    } catch (e: any) {
      setError(e?.detail?.log || String(e));
      setPdf(null);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", height: "100vh" }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div>
          <button onClick={onBack}>← Back</button>
          <button onClick={save} disabled={saving}>Save</button>
          <button onClick={compile}>Compile</button>
        </div>
        <CodeMirror
          value={latex}
          extensions={[StreamLanguage.define(stex)]}
          onChange={setLatex}
          height="calc(100vh - 40px)"
        />
      </div>
      <div style={{ overflow: "auto", padding: 16 }}>
        {error ? <pre style={{ color: "crimson" }}>{error}</pre> : <PdfPreview pdfBlob={pdf} />}
      </div>
    </div>
  );
}
```

(Add `@codemirror/legacy-modes` to package.json deps.)

**Step 3: Smoke test the full loop manually**

1. `docker compose up --build`
2. Visit http://localhost:5173, log in with `changeme`.
3. Create "My Resume" from Jake's.
4. Click into it, see the LaTeX skeleton in the editor.
5. Click Compile → PDF renders on the right.
6. Change some text, Compile again → PDF updates.
7. Break the LaTeX on purpose → compile error shows.

**Step 4: Add a Playwright smoke test** at `web/e2e/smoke.spec.ts`

```ts
import { test, expect } from "@playwright/test";

test("create → compile → preview", async ({ page }) => {
  await page.goto("http://localhost:5173");
  await page.getByLabel(/password/i).fill("changeme");
  await page.getByRole("button", { name: /log in/i }).click();
  await page.getByPlaceholder(/new resume name/i).fill("Smoke");
  await page.getByRole("button", { name: /create/i }).click();
  await page.getByRole("button", { name: "Smoke" }).click();
  await page.getByRole("button", { name: /compile/i }).click();
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
});
```

Add `web/playwright.config.ts` pointing at `http://localhost:5173`.

Run: `docker compose up -d && docker compose run --rm web npx playwright install --with-deps && docker compose run --rm web npm run test:e2e`
Expected: PASS.

**Step 5: Commit**

```bash
git add web/
git commit -m "feat(web): raw LaTeX editor + PDF preview, e2e smoke test"
```

---

## Done criteria for the walking skeleton

- `docker compose up` brings up all three services cleanly.
- Logging in with the env-var password works; wrong password rejected.
- Create a resume from Jake's template, edit its LaTeX, compile, and see the PDF render.
- All pytest + Vitest tests pass. Playwright smoke passes.

Next plan: `2026-04-XX-ai-chat-edits.md` — integrates `claude-agent-sdk`, adds the chat sidebar, and implements the accept/reject diff flow.
