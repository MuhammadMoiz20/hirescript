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
