"""Billboard adverts: create (with a Lightning payment intent), activate on
verified settlement, moderate, expire, and list what is on air."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.events.outbox_service import emit
from app.models.ads import BillboardAd
from app.models.catalog import Item
from app.models.payments import PaymentIntent

BOARD_RE = re.compile(r"^bb-\d{1,4}$")
THEMES = {"green", "night", "sun", "berry", "sky", "clay"}
AD_ITEM_CODE = "billboard_ad_slot"


class AdError(Exception):
    pass


def _clean(s: Any, n: int) -> str:
    s = re.sub(r"[\x00-\x1f\x7f<>]", "", str(s or "")).strip()
    return s[:n]


def clean_url(raw: str) -> str:
    raw = (raw or "").strip()
    if not raw:
        return ""
    if not raw.startswith(("http://", "https://")):
        raw = "https://" + raw
    u = urlparse(raw)
    if u.scheme != "https" or not u.hostname or "." not in u.hostname or len(raw) > 200 or "@" in u.netloc:
        raise AdError("bad_url")
    return raw


async def _ad_item(db: AsyncSession) -> Item:
    item = (await db.execute(select(Item).where(Item.code == AD_ITEM_CODE))).scalar_one_or_none()
    if item is None:
        item = Item(code=AD_ITEM_CODE, name="Billboard ad slot", item_type="receipt",
                    description="Receipt for a billboard advert paid with Lightning", emoji="\U0001f4e2")
        db.add(item)
        await db.flush()
    return item


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def ad_out(ad: BillboardAd, mine: bool = False) -> dict[str, Any]:
    out = {
        "id": ad.id,
        "board_id": ad.board_id,
        "brand": ad.brand,
        "headline": ad.headline,
        "subline": ad.subline,
        "cta": ad.cta,
        "url": ad.url,
        "domain": urlparse(ad.url).hostname if ad.url else "",
        "theme": ad.theme,
        "ends_at": _aware(ad.ends_at).isoformat() if ad.ends_at else None,
    }
    if mine:
        out.update({"status": ad.status, "days": ad.days, "price_sats": ad.price_sats, "review_note": ad.review_note})
    return out


async def create_ad(db: AsyncSession, player_id: str, data: dict[str, Any]) -> tuple[BillboardAd, PaymentIntent]:
    board = str(data.get("board_id", ""))
    if not BOARD_RE.match(board):
        raise AdError("bad_board")
    brand = _clean(data.get("brand"), 32)
    headline = _clean(data.get("headline"), 60)
    if len(brand) < 2 or len(headline) < 3:
        raise AdError("missing_text")
    try:
        days = int(data.get("days", 1))
    except (TypeError, ValueError):
        raise AdError("bad_days")
    if not 1 <= days <= settings.ad_max_days:
        raise AdError("bad_days")
    theme = str(data.get("theme", "green"))
    if theme not in THEMES:
        theme = "green"
    url = clean_url(str(data.get("url", "")))

    now = datetime.now(timezone.utc)
    booked = (
        await db.execute(
            select(BillboardAd).where(BillboardAd.board_id == board, BillboardAd.status.in_(("live", "pending_review")))
        )
    ).scalars().all()
    if sum(1 for a in booked if a.status == "pending_review" or (_aware(a.ends_at) or now) > now) >= settings.ad_max_per_board:
        raise AdError("board_full")

    price = settings.ad_price_sats_per_day * days
    ad = BillboardAd(player_id=player_id, board_id=board, brand=brand, headline=headline,
                     subline=_clean(data.get("subline"), 90), cta=_clean(data.get("cta"), 24),
                     url=url, theme=theme, days=days, price_sats=price)
    db.add(ad)
    await db.flush()
    item = await _ad_item(db)
    intent = PaymentIntent(
        player_id=player_id, business_id=None, listing_id=None, item_id=item.id, quantity=1,
        amount_sats=price, amount_ksats=0, currency="sats", status="created",
        purchase_reference=f"ad:{board}:{ad.id[:10]}",
        idempotency_key=f"ad-{ad.id}-{uuid.uuid4().hex[:6]}",
        expires_at=now + timedelta(seconds=settings.invoice_expiry_seconds * 2),
        metadata_json={"kind": "ad", "ad_id": ad.id, "item_code": AD_ITEM_CODE,
                       "item_name": f"Billboard ad · {days} day{'s' if days > 1 else ''}"},
    )
    db.add(intent)
    await db.flush()
    ad.intent_id = intent.id
    await db.commit()
    return ad, intent


def _go_live(ad: BillboardAd) -> None:
    now = datetime.now(timezone.utc)
    ad.status = "live"
    ad.starts_at = now
    ad.ends_at = now + timedelta(days=ad.days)


async def on_paid(db: AsyncSession, intent: PaymentIntent) -> None:
    """Called inside process_settlement's transaction (exactly once)."""
    ad = (await db.execute(select(BillboardAd).where(BillboardAd.id == intent.metadata_json.get("ad_id")))).scalar_one_or_none()
    if ad is None or ad.status != "awaiting_payment":
        return
    if settings.ads_auto_approve:
        _go_live(ad)
        await emit(db, "ads.updated", ad.id, {"board_id": ad.board_id})
    else:
        ad.status = "pending_review"


async def moderate(db: AsyncSession, ad_id: str, approve: bool, note: str = "") -> BillboardAd:
    ad = (await db.execute(select(BillboardAd).where(BillboardAd.id == ad_id))).scalar_one_or_none()
    if ad is None:
        raise AdError("not_found")
    if ad.status != "pending_review":
        raise AdError("not_pending")
    if approve:
        _go_live(ad)
        await emit(db, "ads.updated", ad.id, {"board_id": ad.board_id})
    else:
        ad.status = "rejected"
    ad.review_note = _clean(note, 200)
    await db.commit()
    return ad


async def live_by_board(db: AsyncSession) -> dict[str, list[dict[str, Any]]]:
    now = datetime.now(timezone.utc)
    rows = (await db.execute(select(BillboardAd).where(BillboardAd.status == "live"))).scalars().all()
    out: dict[str, list[dict[str, Any]]] = {}
    changed = False
    for ad in rows:
        if (_aware(ad.ends_at) or now) <= now:
            ad.status = "expired"
            changed = True
            continue
        out.setdefault(ad.board_id, []).append(ad_out(ad))
    if changed:
        await db.commit()
    return out


async def mine(db: AsyncSession, player_id: str) -> list[dict[str, Any]]:
    rows = (
        await db.execute(select(BillboardAd).where(BillboardAd.player_id == player_id).order_by(BillboardAd.created_at.desc()))
    ).scalars().all()
    return [ad_out(a, mine=True) for a in rows[:20]]


async def pending(db: AsyncSession) -> list[dict[str, Any]]:
    rows = (await db.execute(select(BillboardAd).where(BillboardAd.status == "pending_review"))).scalars().all()
    return [ad_out(a, mine=True) | {"player_id": a.player_id} for a in rows]
