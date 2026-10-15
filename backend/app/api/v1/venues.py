"""Venue services: pay for a meal, a drink, a film, a hotel room, a gym
session. Prices live on the server (the client only names the service)."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import error, get_current_profile
from app.db.session import get_db
from app.models.ledger import GameLedgerEntry
from app.models.player import PlayerProfile
from app.services import player_service

router = APIRouter(prefix="/venues", tags=["venues"])

# service id -> (description, price in kobo)
SERVICES: dict[str, tuple[str, int]] = {
    "restaurant_meal": ("Plate of jollof and chicken", 350_000),
    "bar_drink": ("Chilled drink at the bar", 150_000),
    "cinema_ticket": ("Cinema ticket", 250_000),
    "hotel_night": ("Hotel room for the night", 1_500_000),
    "gym_session": ("Gym day pass", 100_000),
    "mall_snack": ("Shawarma at the food court", 200_000),
    "shop_groceries": ("Groceries", 300_000),
}


class SpendIn(BaseModel):
    service: str = Field(max_length=32)
    business_owner: str | None = Field(default=None, max_length=36)


@router.get("/services")
async def services() -> dict[str, Any]:
    return {"services": [{"id": k, "name": n, "price_ngn_minor": p} for k, (n, p) in SERVICES.items()]}


@router.post("/spend")
async def spend(body: SpendIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    if body.service not in SERVICES:
        raise error("unknown_service", "That service isn't offered here.", 404)
    name, price = SERVICES[body.service]
    if await player_service.ngn_balance_minor(db, profile.id) < price:
        raise error("insufficient_funds", "Not enough naira for that.", 409)
    db.add(GameLedgerEntry(account_reference=f"player:{profile.id}", asset_type="ngn_minor", amount_minor_units=-price,
                           transaction_reference=f"venue:{body.service}:{uuid.uuid4().hex[:10]}", entry_type="venue_purchase", description=name))
    if body.service == "gym_session":
        from app.services import society_service

        await society_service.workout(db, profile.id)
    if body.business_owner:
        from app.services import life_service

        await life_service.sell_at_business(db, profile.id, body.business_owner, price)
    await db.commit()
    return {"ok": True, "service": body.service, "price_ngn_minor": price, "balance_ngn_minor": await player_service.ngn_balance_minor(db, profile.id)}
