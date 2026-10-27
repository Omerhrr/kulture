"""Wallet routes: send k-sats to a player, find people, history."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import error, get_current_profile
from app.db.session import get_db
from app.models.player import PlayerProfile
from app.services import life_service, wallet_service
from app.services.wallet_service import WalletError

router = APIRouter(prefix="/wallet", tags=["wallet"])

_MESSAGES = {
    "bad_amount": f"Send between {wallet_service.SEND_MIN:,} and {wallet_service.SEND_MAX:,} k-sats.",
    "no_such_person": "No player with that name.",
    "insufficient_funds": "You don't have that much.",
    "daily_limit": f"You can send up to {wallet_service.DAILY_MAX:,} k-sats a day.",
}


class SendIn(BaseModel):
    to: str = Field(min_length=1, max_length=64)
    amount: int
    note: str = Field(default="", max_length=200)
    idempotency_key: str | None = Field(default=None, max_length=64)


@router.get("")
async def wallet(profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return {
        "balance": await life_service.balance(db, profile.id),
        "history": await wallet_service.history(db, profile.id),
        "limits": {"min": wallet_service.SEND_MIN, "max": wallet_service.SEND_MAX, "daily": wallet_service.DAILY_MAX},
    }


@router.get("/people")
async def people(q: str = Query("", max_length=64), profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
    return await wallet_service.people(db, profile.id, q)


@router.post("/send")
async def send(body: SendIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    try:
        out = await wallet_service.send(db, profile.id, body.to, body.amount, body.note, body.idempotency_key)
    except WalletError as exc:
        code = str(exc)
        raise error(code, _MESSAGES.get(code, code), 404 if code == "no_such_person" else 409 if code in ("insufficient_funds", "daily_limit") else 422)
    if not out.get("repeat"):
        from app.events.bus import manager

        await manager.send_to_player(out["to"]["id"], {"type": "wallet.received", "payload": {"from": out["from"], "amount": out["amount"], "note": out["note"]}})
    return out
