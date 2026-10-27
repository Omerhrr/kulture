"""Player stores: browse, buy, and run your own shelf."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import error, get_current_profile
from app.db.session import get_db
from app.models.player import PlayerProfile
from app.services import store_service as ss
from app.services.store_service import StoreError

router = APIRouter(prefix="/stores", tags=["stores"])

_MESSAGES = {
    "no_store": "You don't run a store yet (Phone → Business).",
    "own_store": "That's your own store.",
    "not_on_shelf": "That isn't on the shelf.",
    "out_of_stock": "Sold out.",
    "insufficient_funds": "Not enough k-sats.",
    "bad_quantity": "Pick a sensible quantity.",
    "shelf_full": "No more room on your shelves (grow the business for more).",
    "not_wholesale": "The wholesalers don't carry that.",
    "wrong_kind": "A restaurant only sells food.",
    "not_sellable": "That can't be sold.",
    "not_in_bag": "You don't have that many.",
    "bad_price": "Keep the price between half and five times the wholesale price.",
}
_STATUS = {"no_store": 404, "not_on_shelf": 404, "bad_quantity": 422, "bad_price": 422}


def _err(exc: StoreError):
    code = str(exc)
    return error(code, _MESSAGES.get(code, code), _STATUS.get(code, 409))


class BuyIn(BaseModel):
    item: str = Field(min_length=1, max_length=64)
    qty: int = 1
    delivery: bool = False
    idempotency_key: str | None = Field(default=None, max_length=64)


class StockIn(BaseModel):
    item: str = Field(min_length=1, max_length=64)
    qty: int = 1


class PriceIn(BaseModel):
    item: str = Field(min_length=1, max_length=64)
    price: int


class ItemIn(BaseModel):
    item: str = Field(min_length=1, max_length=64)


@router.get("")
async def directory(profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
    return await ss.directory(db)


@router.get("/mine")
async def mine(profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    try:
        return await ss.mine(db, profile.id)
    except StoreError as exc:
        raise _err(exc)


async def _run(coro):
    try:
        return await coro
    except StoreError as exc:
        raise _err(exc)


@router.post("/mine/restock")
async def restock(body: StockIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await _run(ss.restock(db, profile.id, body.item, body.qty))


@router.post("/mine/shelve")
async def shelve(body: StockIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await _run(ss.shelve(db, profile.id, body.item, body.qty))


@router.post("/mine/price")
async def price(body: PriceIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await _run(ss.set_price(db, profile.id, body.item, body.price))


@router.post("/mine/unshelve")
async def unshelve(body: ItemIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await _run(ss.unshelve(db, profile.id, body.item))


@router.get("/{owner_id}")
async def store(owner_id: str, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await _run(ss.store(db, owner_id))


@router.post("/{owner_id}/buy")
async def buy(owner_id: str, body: BuyIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    out = await _run(ss.buy(db, profile.id, owner_id, body.item, body.qty, body.delivery, body.idempotency_key))
    if not out.get("repeat"):
        from app.events.bus import manager

        await manager.send_to_player(owner_id, {"type": "store.sale", "payload": {"buyer": out["buyer"], "name": out["name"], "qty": out["qty"], "got": out["owner_got"]}})
    return out
