from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.auth import require_user
from app.db import get_db
from app.models import Profile as ProfileModel
from app.schemas.profile import Profile

router = APIRouter(prefix="/profile", tags=["profile"])

EMPTY_SHELL = {"legal_name": "", "email": "unset@example.com"}


@router.get("", response_model=Profile)
async def get_profile(user_id=Depends(require_user), db=Depends(get_db)):
    row = (
        await db.execute(select(ProfileModel).where(ProfileModel.user_id == user_id))
    ).scalar_one_or_none()
    if row is None:
        return Profile.model_validate(EMPTY_SHELL)
    return Profile.model_validate(row.data)


@router.put("", response_model=Profile)
async def put_profile(
    payload: Profile, user_id=Depends(require_user), db=Depends(get_db)
):
    data = payload.model_dump(mode="json")
    stmt = pg_insert(ProfileModel).values(user_id=user_id, data=data)
    stmt = stmt.on_conflict_do_update(
        index_elements=[ProfileModel.user_id],
        set_={"data": data, "updated_at": func.now()},
    )
    await db.execute(stmt)
    await db.commit()
    return payload
