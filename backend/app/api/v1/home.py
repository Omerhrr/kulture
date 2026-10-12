"""Home furniture routes: layout, buy, move, sell."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import error, get_current_profile
from app.db.session import get_db
from app.models.player import PlayerProfile
from app.services import home_service, player_service
from app.services.home_service import HomeError

router = APIRouter(prefix="/home", tags=["home"])
_MSG = {
    "already_initialised": "Your home is already furnished.",
    "not_starter_item": "That isn't part of the starter furniture.",
    "bad_position": "That spot is outside your home.",
    "not_found": "You don't own that item.",
    "unknown_item": "That item isn't in the catalogue.",
    "insufficient_funds": "Not enough naira for that.",
    "home_full": "Your home is full - sell something first.",
}


def _err(e: HomeError):
    code = str(e)
    return error(code, _MSG.get(code, code), 404 if code in ("not_found", "unknown_item") else 409 if code in ("insufficient_funds", "home_full", "already_initialised") else 422)


class Placed(BaseModel):
    sku: str = Field(max_length=32)
    x: float
    z: float
    rot: int = 0


class InitIn(BaseModel):
    items: list[Placed] = Field(max_length=40)


class MoveIn(BaseModel):
    x: float
    z: float
    rot: int = 0


class BuyIn(BaseModel):
    sku: str = Field(max_length=32)
    x: float = 0.0
    z: float = 0.0


async def _state(db: AsyncSession, pid: str) -> dict[str, Any]:
    return {
        "items": [home_service.item_out(i) for i in await home_service.items(db, pid)],
        "catalog": home_service.catalog_out(),
        "balance_ngn_minor": await player_service.ngn_balance_minor(db, pid),
    }


@router.get("")
async def get_home(profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await _state(db, profile.id)


@router.post("/init")
async def init(body: InitIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    try:
        await home_service.init_layout(db, profile.id, [i.model_dump() for i in body.items])
    except HomeError as e:
        raise _err(e)
    return await _state(db, profile.id)


@router.put("/items/{uid}")
async def move(uid: str, body: MoveIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    try:
        return home_service.item_out(await home_service.move(db, profile.id, uid, body.x, body.z, body.rot))
    except HomeError as e:
        raise _err(e)


@router.post("/buy")
async def buy(body: BuyIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    try:
        it = await home_service.buy(db, profile.id, body.sku, body.x, body.z)
    except HomeError as e:
        raise _err(e)
    return {"item": home_service.item_out(it), **(await _state(db, profile.id))}


@router.post("/items/{uid}/sell")
async def sell(uid: str, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    try:
        refund = await home_service.sell(db, profile.id, uid)
    except HomeError as e:
        raise _err(e)
    return {"refund_ngn_minor": refund, **(await _state(db, profile.id))}
