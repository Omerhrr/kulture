"""Your character: look and name are yours to choose; the life is given."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import error, get_current_profile
from app.db.session import get_db
from app.models.player import PlayerProfile
from app.services import character_service as cs
from app.services.character_service import CharacterError

router = APIRouter(prefix="/character", tags=["character"])

_MESSAGES = {
    "no_character": "Create your character first.",
    "already_created": "You already have a character.",
    "bad_name": "Pick a name of 2 to 18 letters.",
    "not_your_home": "That isn't your home.",
}
_STATUS = {"no_character": 404, "already_created": 409, "bad_name": 422, "not_your_home": 409}


def _err(exc: CharacterError):
    code = str(exc)
    return error(code, _MESSAGES.get(code, code), _STATUS.get(code, 400))


class CreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    look: dict[str, Any] = Field(default_factory=dict)
    # a Sim made before characters were kept on the server
    legacy: dict[str, Any] | None = None


class UpdateIn(BaseModel):
    name: str | None = Field(default=None, max_length=40)
    look: dict[str, Any] | None = None


@router.get("")
async def mine(profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    c = await cs.get(db, profile.id)
    if c is None:
        raise _err(CharacterError("no_character"))
    return cs.out(c)


@router.post("", status_code=201)
async def create(body: CreateIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    try:
        return cs.out(await cs.create(db, profile.id, body.name, body.look, body.legacy))
    except CharacterError as exc:
        raise _err(exc)


@router.patch("")
async def update(body: UpdateIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    try:
        return cs.out(await cs.update(db, profile.id, body.name, body.look))
    except CharacterError as exc:
        raise _err(exc)
