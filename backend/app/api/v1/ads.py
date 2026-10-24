"""Billboard advert routes. Buying an ad returns a normal Lightning payment
intent (+ invoice), so the client reuses the verified payment dialog."""

from __future__ import annotations

import hmac
from typing import Any

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import error, get_current_profile
from app.api.v1.payments import _intent_out
from app.core.config import settings
from app.db.session import get_db
from app.models.player import PlayerProfile
from app.payments.lightning_service import PaymentError, create_invoice_for_intent, invoice_for_intent
from app.services import ads_service
from app.services.ads_service import AdError

router = APIRouter(tags=["ads"])

_MSG = {
    "bad_board": "Unknown billboard.",
    "missing_text": "Add a brand name and a headline.",
    "bad_days": f"Pick 1 to {settings.ad_max_days} days.",
    "bad_url": "Links must be a normal https:// website.",
    "board_full": "This board is fully booked - try another one.",
    "not_found": "Ad not found.",
    "not_pending": "That ad isn't waiting for review.",
}


class AdIn(BaseModel):
    board_id: str = Field(max_length=16)
    brand: str = Field(max_length=40)
    headline: str = Field(max_length=80)
    subline: str = Field(default="", max_length=120)
    cta: str = Field(default="", max_length=30)
    url: str = Field(default="", max_length=220)
    theme: str = Field(default="green", max_length=16)
    days: int = 1


@router.get("/ads/boards")
async def boards(profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return {
        "boards": await ads_service.live_by_board(db),
        "price_sats_per_day": settings.ad_price_sats_per_day,
        "max_days": settings.ad_max_days,
        "auto_approve": settings.ads_auto_approve,
    }


@router.get("/ads/mine")
async def my_ads(profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
    return await ads_service.mine(db, profile.id)


@router.post("/ads", status_code=201)
async def create_ad(body: AdIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    try:
        ad, intent = await ads_service.create_ad(db, profile.id, body.model_dump())
    except AdError as exc:
        raise error(str(exc), _MSG.get(str(exc), str(exc)), 409 if str(exc) == "board_full" else 422)
    try:
        await create_invoice_for_intent(db, intent)
    except PaymentError as exc:
        raise error("invoice_failed", str(exc), 409, retryable=True)
    intent, inv = await invoice_for_intent(db, intent.id)
    return {"ad": ads_service.ad_out(ad, mine=True), "intent": _intent_out(intent, inv).model_dump(mode="json")}


# ------------------------------------------------------------- moderation
def _admin(x_admin_token: str = Header(default="")) -> None:
    if not settings.admin_token or not hmac.compare_digest(x_admin_token, settings.admin_token):
        raise error("forbidden", "Moderator token required.", 403)


@router.get("/admin/ads/pending", dependencies=[Depends(_admin)])
async def pending(db: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
    return await ads_service.pending(db)


class Review(BaseModel):
    approve: bool
    note: str = Field(default="", max_length=200)


@router.post("/admin/ads/{ad_id}/review", dependencies=[Depends(_admin)])
async def review(ad_id: str, body: Review, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    try:
        ad = await ads_service.moderate(db, ad_id, body.approve, body.note)
    except AdError as exc:
        raise error(str(exc), _MSG.get(str(exc), str(exc)), 404 if str(exc) == "not_found" else 409)
    return ads_service.ad_out(ad, mine=True)
