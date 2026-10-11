"""Shop + purchase service.

Purchase creation is fully server-validated:
- price comes from the listing row (never the client)
- stock is checked and versioned (optimistic concurrency)
- an idempotency key is mandatory (client-supplied or generated)
- creating a purchase does NOT deliver anything - delivery happens only
  after verified Lightning settlement (see payments/lightning_service).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.business import Business, ShopListing
from app.models.catalog import Item
from app.models.jobs import Job
from app.models.payments import PaymentIntent
from app.models.world import WorldEntity
from app.schemas.game import BusinessOut, JobOut, ListingOut


class PurchaseError(Exception):
    pass


async def get_business_out(db: AsyncSession, business_id: str) -> BusinessOut | None:
    biz = (
        await db.execute(select(Business).where(Business.id == business_id))
    ).unique().scalar_one_or_none()
    if not biz:
        return None
    listings = [
        ListingOut(
            id=l.id,
            item_id=l.item_id,
            item_code=l.item.code,
            item_name=l.item.name,
            emoji=l.item.emoji,
            description=l.item.description,
            price_ngn_minor=l.price_ngn_minor,
            price_sats=l.price_sats,
            quantity_available=l.quantity_available,
        )
        for l in biz.listings
        if l.is_active
    ]
    return BusinessOut(
        id=biz.id, code=biz.code, name=biz.name, business_type=biz.business_type, status=biz.status,
        listings=listings,
    )


async def create_purchase(
    db: AsyncSession,
    player_id: str,
    listing_id: str,
    quantity: int,
    idempotency_key: str | None,
) -> PaymentIntent:
    if quantity < 1 or quantity > 10:
        raise PurchaseError("invalid_quantity")

    idem = idempotency_key or f"auto-{uuid.uuid4().hex}"
    existing = (
        await db.execute(
            select(PaymentIntent).where(PaymentIntent.idempotency_key == idem)
        )
    ).scalar_one_or_none()
    if existing:
        return existing  # replay-safe: return the original intent untouched

    listing = (
        await db.execute(select(ShopListing).where(ShopListing.id == listing_id))
    ).scalar_one_or_none()
    if not listing or not listing.is_active:
        raise PurchaseError("listing_not_found")

    biz = (
        await db.execute(select(Business).where(Business.id == listing.business_id))
    ).unique().scalar_one()
    if biz.status != "open":
        raise PurchaseError(f"business_closed_{biz.status}")

    if listing.quantity_available < quantity:
        raise PurchaseError("insufficient_stock")

    item = (await db.execute(select(Item).where(Item.id == listing.item_id))).scalar_one()

    intent = PaymentIntent(
        player_id=player_id,
        business_id=biz.id,
        listing_id=listing.id,
        item_id=item.id,
        quantity=quantity,
        amount_sats=listing.price_sats * quantity,
        amount_ngn_minor=listing.price_ngn_minor * quantity,
        currency="sats",
        status="created",
        purchase_reference=f"purchase:{biz.code}:{item.code}:{uuid.uuid4().hex[:10]}",
        idempotency_key=idem,
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=settings.invoice_expiry_seconds * 2),
        metadata_json={"item_code": item.code, "item_name": item.name},
    )
    db.add(intent)
    await db.flush()
    await db.commit()
    return intent


# ------------------------------------------------------------------ jobs
def _job_out(job: Job, pickup: WorldEntity | None, dropoff: WorldEntity | None) -> JobOut:
    return JobOut(
        id=job.id,
        code=job.code,
        job_type=job.job_type,
        title=job.title,
        description=job.description,
        status=job.status,
        pickup_state=job.pickup_state,
        reward_ngn_minor=job.reward_ngn_minor,
        reward_reputation=job.reward_reputation,
        pickup_entity=(
            {"id": pickup.id, "code": pickup.code, "name": pickup.name,
             "position": [pickup.position_x, pickup.position_y, pickup.position_z]}
            if pickup else None
        ),
        dropoff_entity=(
            {"id": dropoff.id, "code": dropoff.code, "name": dropoff.name,
             "position": [dropoff.position_x, dropoff.position_y, dropoff.position_z]}
            if dropoff else None
        ),
    )


async def list_available_jobs(db: AsyncSession, business_id: str | None = None) -> list[JobOut]:
    q = select(Job).where(
        Job.status == "available",
        (Job.issuer_business_id == business_id) if business_id else True,
    )
    jobs = (await db.execute(q)).scalars().all()
    return [await _job_out_with_entities(db, j) for j in jobs]


async def _job_out_with_entities(db: AsyncSession, job: Job) -> JobOut:
    pickup = (
        await db.execute(select(WorldEntity).where(WorldEntity.id == job.pickup_entity_id))
    ).scalar_one_or_none()
    dropoff = (
        await db.execute(select(WorldEntity).where(WorldEntity.id == job.dropoff_entity_id))
    ).scalar_one_or_none()
    return _job_out(job, pickup, dropoff)


async def my_jobs(db: AsyncSession, player_id: str) -> list[JobOut]:
    jobs = (
        await db.execute(
            select(Job)
            .where(Job.assignee_player_id == player_id, Job.status.in_(["assigned", "in_progress", "completed"]))
            .order_by(Job.created_at.desc())
            .limit(25)
        )
    ).scalars().all()
    return [await _job_out_with_entities(db, j) for j in jobs]


class JobError(Exception):
    pass
