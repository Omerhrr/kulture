"""Pydantic schemas - world, interactions, shops, jobs, payments, WS envelopes."""

from __future__ import annotations

from app.schemas.utc import UTCDatetime as datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


# ----------------------------------------------------------------- world
class EntityOut(BaseModel):
    id: str
    code: str
    name: str
    entity_type: str
    position: tuple[float, float, float]
    rotation: float = 0.0
    interaction_radius: float
    is_active: bool
    business_id: str | None = None
    npc_agent_code: str | None = None
    metadata: dict[str, Any] = {}


class RegionOut(BaseModel):
    id: str
    name: str
    slug: str
    description: str
    entities: list[EntityOut]


class InteractionIn(BaseModel):
    entity_id: str
    position: tuple[float, float, float]


class InteractionOption(BaseModel):
    kind: Literal["shop", "job_board", "pos_kiosk", "landmark", "transport", "dialogue"]
    label: str
    business_id: str | None = None
    npc_agent_code: str | None = None


class InteractionOut(BaseModel):
    entity_id: str
    entity_name: str
    options: list[InteractionOption]


# ----------------------------------------------------------------- shop
class ListingOut(BaseModel):
    id: str
    item_id: str
    item_code: str
    item_name: str
    emoji: str
    description: str
    price_ngn_minor: int
    price_sats: int
    quantity_available: int


class BusinessOut(BaseModel):
    id: str
    code: str
    name: str
    business_type: str
    status: str
    listings: list[ListingOut]


class PurchaseIn(BaseModel):
    listing_id: str
    quantity: int = Field(default=1, ge=1, le=10)
    idempotency_key: str | None = None


# ----------------------------------------------------------------- payments
class PaymentIntentOut(BaseModel):
    id: str
    status: str
    amount_sats: int
    amount_ngn_minor: int
    item_code: str
    item_name: str
    quantity: int
    purchase_reference: str
    expires_at: datetime | None = None
    invoice_bolt11: str | None = None
    invoice_expires_at: datetime | None = None
    provider: str | None = None


class DevPayIn(BaseModel):
    invoice_bolt11: str


# ----------------------------------------------------------------- jobs
class JobOut(BaseModel):
    id: str
    code: str
    job_type: str
    title: str
    description: str
    status: str
    pickup_state: str
    reward_ngn_minor: int
    reward_reputation: int
    pickup_entity: dict[str, Any] | None = None
    dropoff_entity: dict[str, Any] | None = None


# ----------------------------------------------------------------- WS
class WSClientMessage(BaseModel):
    type: Literal[
        "player.move", "entity.interact", "world.subscribe", "state.resync", "ping"
    ]
    payload: dict[str, Any] = {}
