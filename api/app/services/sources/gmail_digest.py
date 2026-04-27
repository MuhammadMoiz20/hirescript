"""Gmail digest source — IMAP poll + Haiku posting extraction.

Single-tenant, small. The module owns three concerns:

1. :func:`fetch_unread_emails` — connect to ``imap.gmail.com:993`` over
   SSL via ``aioimaplib.IMAP4_SSL``, log in with the ``GMAIL_USER`` /
   ``GMAIL_APP_PASSWORD`` env vars, select the ``GMAIL_DIGEST_LABEL``
   label (default ``JobAlerts``), fetch every UNSEEN message and
   return ``[(uid, html_body)]``.
2. :func:`extract_postings` — given an email body, ask Haiku to extract
   every job posting as ``{company, title, apply_url, location?}`` and
   return the parsed list. Output is strict JSON.
3. :func:`poll_and_ingest` — orchestrator. For each unread email runs
   ``extract_postings``; for each extracted posting upserts into
   ``job_postings`` with ``source='gmail_digest'`` and
   ``source_job_id=sha256(apply_url)[:32]``. ``company_id`` is left NULL
   for gmail-sourced rows. If the apply_url matches one of the existing
   ATS adapters' ``matches_url``, ``meta['detected_source']`` is set
   so a future enrichment pass can re-fetch the canonical posting.
   IMAP messages are marked ``\\Seen`` after a successful extract.
   Returns the total number of newly-created posting rows.
"""

from __future__ import annotations

import email
import hashlib
import json
import logging
import os
from email import policy
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import JobPosting
from app.services import claude_router
from app.services.claude_router import get_api_client
from app.services.sources import SOURCES

log = logging.getLogger(__name__)

__all__ = [
    "fetch_unread_emails",
    "mark_seen",
    "extract_postings",
    "poll_and_ingest",
]


_IMAP_HOST = "imap.gmail.com"
_IMAP_PORT = 993
_DEFAULT_LABEL = "JobAlerts"

_SYSTEM_PROMPT = (
    "Extract every job posting from this email. For each posting, "
    "return an object with keys `company` (string), `title` (string), "
    "`apply_url` (string), and optionally `location` (string). Output "
    'STRICT JSON of the shape `{"postings": [...]}` with no prose. '
    "If the email contains no job postings, return "
    '`{"postings": []}`.'
)


# --- IMAP -------------------------------------------------------------------


async def _imap_login_and_select(label: str):
    """Connect, log in, and SELECT ``label``. Returns the open client.

    Raises on any failure — callers handle that as "no mail".
    """
    import aioimaplib

    user = os.environ["GMAIL_USER"]
    pw = os.environ["GMAIL_APP_PASSWORD"]
    client = aioimaplib.IMAP4_SSL(host=_IMAP_HOST, port=_IMAP_PORT)
    await client.wait_hello_from_server()
    resp = await client.login(user, pw)
    if resp.result != "OK":
        raise RuntimeError(f"imap login failed: {resp.result}")
    sel = await client.select(label)
    if sel.result != "OK":
        raise RuntimeError(f"imap select {label!r} failed: {sel.result}")
    return client


def _extract_html_body(raw: bytes) -> str:
    """Pull the best HTML (or plain) body from a raw RFC822 message."""
    try:
        msg = email.message_from_bytes(raw, policy=policy.default)
    except Exception:  # noqa: BLE001
        return raw.decode("utf-8", errors="replace")
    # Prefer HTML parts; fall back to plain.
    html_part = None
    plain_part = None
    if msg.is_multipart():
        for part in msg.walk():
            ct = (part.get_content_type() or "").lower()
            if ct == "text/html" and html_part is None:
                html_part = part
            elif ct == "text/plain" and plain_part is None:
                plain_part = part
    else:
        return msg.get_content() if hasattr(msg, "get_content") else msg.get_payload(decode=True).decode("utf-8", errors="replace")
    chosen = html_part or plain_part
    if chosen is None:
        return ""
    try:
        return chosen.get_content()
    except Exception:  # noqa: BLE001
        payload = chosen.get_payload(decode=True) or b""
        return payload.decode("utf-8", errors="replace")


async def fetch_unread_emails() -> list[tuple[str, str]]:
    """Return ``[(uid, html_body)]`` for every UNSEEN message in the label.

    Returns ``[]`` (and logs) on any IMAP error so a transient outage
    doesn't poison the scheduler tick.
    """
    label = os.environ.get("GMAIL_DIGEST_LABEL", _DEFAULT_LABEL)
    try:
        client = await _imap_login_and_select(label)
    except Exception:  # noqa: BLE001
        log.exception("gmail_digest: imap login/select failed")
        return []

    out: list[tuple[str, str]] = []
    try:
        search = await client.search("UNSEEN")
        if search.result != "OK":
            log.warning("gmail_digest: UNSEEN search failed: %s", search.result)
            return []
        # search.lines[0] is a space-separated list of uids (as bytes).
        raw_ids = (search.lines[0] or b"").decode("ascii", errors="replace").split()
        for uid in raw_ids:
            try:
                fr = await client.fetch(uid, "(RFC822)")
                if fr.result != "OK":
                    continue
                # The body is in fr.lines; pick the first bytes blob.
                body_bytes = b""
                for line in fr.lines:
                    if isinstance(line, (bytes, bytearray)) and len(line) > 64:
                        body_bytes = bytes(line)
                        break
                html = _extract_html_body(body_bytes)
                out.append((uid, html))
            except Exception:  # noqa: BLE001
                log.exception("gmail_digest: fetch uid=%s failed", uid)
    finally:
        try:
            await client.logout()
        except Exception:  # noqa: BLE001
            pass
    return out


async def mark_seen(uid: str) -> None:
    """Flag a message as ``\\Seen`` so a re-poll skips it.

    Errors are logged and swallowed — the worst outcome is re-processing
    the email next tick (which the upsert handles cleanly).
    """
    try:
        client = await _imap_login_and_select(
            os.environ.get("GMAIL_DIGEST_LABEL", _DEFAULT_LABEL)
        )
    except Exception:  # noqa: BLE001
        log.exception("gmail_digest: mark_seen login failed for uid=%s", uid)
        return
    try:
        await client.store(uid, "+FLAGS", "\\Seen")
    except Exception:  # noqa: BLE001
        log.exception("gmail_digest: mark_seen store failed for uid=%s", uid)
    finally:
        try:
            await client.logout()
        except Exception:  # noqa: BLE001
            pass


# --- Extract (Haiku) --------------------------------------------------------


def _extract_text(response: Any) -> str:
    """Concatenate text blocks from an Anthropic response."""
    parts: list[str] = []
    for blk in getattr(response, "content", []) or []:
        if getattr(blk, "type", None) == "text":
            parts.append(getattr(blk, "text", "") or "")
    return "".join(parts)


async def extract_postings(
    db: AsyncSession, *, html_body: str
) -> list[dict]:
    """Ask Haiku to extract every posting from ``html_body``.

    Returns a list of dicts with keys ``company``, ``title``, ``apply_url``
    and optionally ``location``. Empty list if the model returns
    nothing or the response can't be parsed (we log and degrade rather
    than raising — one bad email shouldn't kill the digest tick).
    """
    choice = await claude_router.choose(db, task_kind="classify")
    client = get_api_client()
    response = await client.messages.create(
        model=choice["model"],
        max_tokens=2048,
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": html_body or ""}],
    )

    usage = getattr(response, "usage", None)
    input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
    output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
    try:
        await claude_router.record_usage(
            db,
            client=choice["client"],
            model=choice["model"],
            task_kind="classify",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )
    except Exception:  # noqa: BLE001
        log.exception("gmail_digest: record_usage failed")

    raw = _extract_text(response).strip()
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        log.warning("gmail_digest: model returned non-JSON: %r", raw[:200])
        return []
    if not isinstance(parsed, dict):
        return []
    postings = parsed.get("postings")
    if not isinstance(postings, list):
        return []
    out: list[dict] = []
    for p in postings:
        if not isinstance(p, dict):
            continue
        if not p.get("apply_url") or not p.get("title"):
            continue
        out.append(
            {
                "company": (p.get("company") or "") or "",
                "title": p.get("title") or "",
                "apply_url": p.get("apply_url") or "",
                "location": p.get("location") or None,
            }
        )
    return out


# --- Orchestrator -----------------------------------------------------------


def _detected_source(apply_url: str) -> str | None:
    """Return the registered source name whose ``matches_url`` accepts
    ``apply_url``, or ``None`` if no adapter matches."""
    for s in SOURCES.values():
        try:
            if s.matches_url(apply_url):
                return s.name
        except Exception:  # noqa: BLE001 — adapters MUST not raise here
            log.exception(
                "gmail_digest: matches_url raised for %s on %r",
                s.name,
                apply_url,
            )
    return None


def _source_job_id(apply_url: str) -> str:
    return hashlib.sha256(apply_url.encode("utf-8")).hexdigest()[:32]


async def poll_and_ingest(db: AsyncSession, *, user_id: int) -> int:
    """Poll Gmail and upsert any extracted postings. Returns count created.

    Skips entirely (returns 0, logs) if ``GMAIL_USER`` is unset — the
    feature is opt-in via env. IMAP / extraction errors are logged and
    treated as "no postings this tick" so the scheduler keeps running.
    """
    if not os.environ.get("GMAIL_USER"):
        log.info("gmail_digest: GMAIL_USER not set; skipping poll")
        return 0

    try:
        emails = await fetch_unread_emails()
    except Exception:  # noqa: BLE001
        log.exception("gmail_digest: fetch_unread_emails failed")
        return 0

    created = 0
    for uid, body in emails:
        try:
            postings = await extract_postings(db, html_body=body)
        except Exception:  # noqa: BLE001
            log.exception(
                "gmail_digest: extract failed for uid=%s; leaving unread",
                uid,
            )
            continue

        for p in postings:
            apply_url = p["apply_url"]
            sjid = _source_job_id(apply_url)
            existing = (
                await db.execute(
                    select(JobPosting).where(
                        JobPosting.user_id == user_id,
                        JobPosting.source == "gmail_digest",
                        JobPosting.source_job_id == sjid,
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                continue

            meta: dict[str, Any] = {"email_uid": uid}
            detected = _detected_source(apply_url)
            if detected is not None:
                meta["detected_source"] = detected
            company_name = p.get("company") or ""
            if company_name:
                meta["email_company_name"] = company_name

            row = JobPosting(
                user_id=user_id,
                source="gmail_digest",
                source_job_id=sjid,
                company_id=None,
                title=p["title"],
                location=p.get("location"),
                apply_url=apply_url,
                description_html=None,
                description_text=p.get("title") or "",
                meta=meta,
                status="new",
            )
            db.add(row)
            created += 1

        await db.commit()

        try:
            await mark_seen(uid)
        except Exception:  # noqa: BLE001
            log.exception(
                "gmail_digest: mark_seen failed for uid=%s", uid
            )

    return created
