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
