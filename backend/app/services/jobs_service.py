"""Jobs service - accept / pickup / complete with server-validated positions.

The delivery flow (spec KK-002):
1. accept   - job must be `available`; becomes `assigned` to this player.
2. pickup   - player must be within the pickup entity radius; grants the
              quest item `package_parcel`; job becomes `in_progress`.
3. complete - player must be within the dropoff radius AND hold the parcel;
              consumes it, pays k-sats + reputation through the ledger.
All position checks happen here, server-side, against authoritative state.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog import Item
from app.models.events import OutboxEvent
from app.models.jobs import Job
from app.models.ledger import GameLedgerEntry
from app.models.player import PlayerProfile
from app.models.world import WorldEntity
from app.services import inventory_service, world_service
from app.services.shop_service import JobError


async def _entity(db: AsyncSession, entity_id: str) -> WorldEntity:
    e = (
        await db.execute(select(WorldEntity).where(WorldEntity.id == entity_id))
    ).scalar_one_or_none()
    if not e:
        raise JobError("entity_not_found")
    return e


async def accept_job(db: AsyncSession, player_id: str, job_id: str) -> Job:
    job = (await db.execute(select(Job).where(Job.id == job_id))).scalar_one_or_none()
    if not job:
        raise JobError("job_not_found")
    if job.status != "available":
        raise JobError(f"job_not_available_{job.status}")
    job.status = "assigned"
    job.assignee_player_id = player_id
    job.accepted_at = datetime.now(timezone.utc)
    db.add(
        OutboxEvent(
            event_type="job.updated", aggregate_id=job.id, player_id=player_id,
            payload={"job_id": job.id, "status": job.status},
        )
    )
    await db.commit()
    return job


async def pickup_job(
    db: AsyncSession, player_id: str, job_id: str, px: float, pz: float
) -> Job:
    job = (await db.execute(select(Job).where(Job.id == job_id))).scalar_one_or_none()
    if not job or job.assignee_player_id != player_id:
        raise JobError("job_not_assigned_to_player")
    if job.status != "assigned":
        raise JobError(f"job_wrong_state_{job.status}")

    pickup = await _entity(db, job.pickup_entity_id)
    if world_service.distance(px, pz, pickup.position_x, pickup.position_z) > max(
        pickup.interaction_radius, 8.0
    ):
        raise JobError("too_far_from_pickup")

    parcel = (
        await db.execute(select(Item).where(Item.code == "quest_parcel"))
    ).scalar_one_or_none()
    if not parcel:
        raise JobError("world_not_seeded")

    await inventory_service.grant_items(
        db, player_id, parcel.id, 1, reference=f"job_pickup:{job.code}"
    )
    job.pickup_state = "picked_up"
    job.status = "in_progress"
    db.add(
        OutboxEvent(
            event_type="job.updated", aggregate_id=job.id, player_id=player_id,
            payload={"job_id": job.id, "status": job.status, "pickup_state": job.pickup_state},
        )
    )
    await db.commit()
    return job


async def complete_job(
    db: AsyncSession, player_id: str, job_id: str, px: float, pz: float
) -> Job:
    job = (await db.execute(select(Job).where(Job.id == job_id))).scalar_one_or_none()
    if not job or job.assignee_player_id != player_id:
        raise JobError("job_not_assigned_to_player")
    if job.status != "in_progress" or job.pickup_state != "picked_up":
        raise JobError("job_not_in_progress")

    dropoff = await _entity(db, job.dropoff_entity_id)
    if world_service.distance(px, pz, dropoff.position_x, dropoff.position_z) > max(
        dropoff.interaction_radius, 8.0
    ):
        raise JobError("too_far_from_dropoff")

    parcel = (
        await db.execute(select(Item).where(Item.code == "quest_parcel"))
    ).scalar_one()
    if not await inventory_service.consume_items(db, player_id, parcel.id, 1):
        raise JobError("parcel_missing_from_inventory")

    job.status = "completed"
    job.pickup_state = "delivered"
    job.completed_at = datetime.now(timezone.utc)

    db.add(
        GameLedgerEntry(
            account_reference=f"player:{player_id}",
            asset_type="ksats",
            amount_minor_units=job.reward_ksats,
            transaction_reference=f"job_reward:{job.code}:{uuid.uuid4().hex[:8]}",
            entry_type="job_reward",
            description=f"Completed delivery job {job.title}",
        )
    )
    db.add(
        GameLedgerEntry(
            account_reference=f"player:{player_id}",
            asset_type="reputation",
            amount_minor_units=job.reward_reputation,
            transaction_reference=f"job_rep:{job.code}",
            entry_type="reputation_gain",
            description=f"Reputation for {job.title}",
        )
    )
    profile = (
        await db.execute(select(PlayerProfile).where(PlayerProfile.id == player_id))
    ).scalar_one()
    profile.reputation += job.reward_reputation

    db.add(
        OutboxEvent(
            event_type="job.updated", aggregate_id=job.id, player_id=player_id,
            payload={
                "job_id": job.id, "status": "completed",
                "reward_ksats": job.reward_ksats,
                "reward_reputation": job.reward_reputation,
            },
        )
    )
    await db.commit()
    return job
