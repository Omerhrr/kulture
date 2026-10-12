"""Pydantic schemas - auth & players."""

from __future__ import annotations

from app.schemas.utc import UTCDatetime as datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class RegisterIn(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[a-zA-Z0-9_]+$")
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=64)


class LoginIn(BaseModel):
    username: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    player_id: str


class PlayerOut(BaseModel):
    id: str
    user_id: str
    username: str
    display_name: str
    avatar_id: str
    reputation: int
    ngn_balance_minor: int
    position: tuple[float, float, float] | None = None
    region_id: str | None = None
    state_version: int = 0
    created_at: datetime | None = None


class InventoryItemOut(BaseModel):
    item_id: str
    code: str
    name: str
    emoji: str
    quantity: int


class InventoryOut(BaseModel):
    items: list[InventoryItemOut]


class TransactionOut(BaseModel):
    id: str
    entry_type: str
    asset_type: str
    amount_minor_units: int
    description: str
    transaction_reference: str
    created_at: datetime
