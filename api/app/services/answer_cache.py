"""Answer cache primitive.

Hash-keyed lookup/store for short screener answers ("Why this company?",
"What's your salary expectation?", etc). Normalizes the question (case-
and punctuation-insensitive) so trivially-different phrasings collide on
the same row.
"""

from __future__ import annotations

import hashlib
import re

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AnswerCache


_PUNCT_RE = re.compile(r"[^a-z0-9 ]")
_WS_RE = re.compile(r"\s+")


def normalize_question(text: str) -> str:
    """Lowercase, strip non-alphanumerics (keeping spaces), collapse whitespace.

    Stable across casing and punctuation differences.
    """
    if not text:
        return ""
    lowered = text.lower()
    no_punct = _PUNCT_RE.sub("", lowered)
    return _WS_RE.sub(" ", no_punct).strip()


def question_hash(question: str) -> str:
    return hashlib.sha256(normalize_question(question).encode("utf-8")).hexdigest()


def _dialect_name(session: AsyncSession) -> str:
    bind = session.bind
    if bind is None:
        return "postgresql"
    return bind.dialect.name


async def lookup(
    db: AsyncSession, *, user_id: int, question: str, bump: bool = True
) -> str | None:
    """Return the cached answer for ``question`` or ``None`` on miss.

    When ``bump=True`` (default), updates ``last_used_at`` on hit so we can
    later age out stale entries. The bump is FLUSHED, not committed — the
    caller's outer transaction owns the commit. Pass ``bump=False`` to skip
    the timestamp update entirely (e.g. when querying read-only).
    """
    h = question_hash(question)
    row = (
        await db.execute(
            select(AnswerCache).where(
                AnswerCache.user_id == user_id,
                AnswerCache.question_hash == h,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    if bump:
        row.last_used_at = func.now()
        await db.flush()
    return row.answer_text


async def store(
    db: AsyncSession, *, user_id: int, question: str, answer: str
) -> None:
    """Insert or update the cached answer for ``question``.

    Flushes the upsert; callers must commit. This keeps the primitive
    composable inside a larger orchestrator transaction.
    """
    h = question_hash(question)
    if _dialect_name(db) == "sqlite":
        insert = sqlite_insert
    else:
        insert = pg_insert
    stmt = insert(AnswerCache).values(
        user_id=user_id,
        question_hash=h,
        question_text=question,
        answer_text=answer,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["user_id", "question_hash"],
        set_={
            "answer_text": answer,
            "question_text": question,
            "last_used_at": func.now(),
        },
    )
    await db.execute(stmt)
    await db.flush()
