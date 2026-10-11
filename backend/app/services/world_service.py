"""World service — region payloads, entity resolution, server-side interaction validation."""

from __future__ import annotations

import math

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.business import Business, NPCAgent
from app.models.world import WorldEntity, WorldRegion
from app.schemas.game import (
    EntityOut,
    InteractionOption,
    InteractionOut,
    RegionOut,
)


def distance(ax: float, az: float, bx: float, bz: float) -> float:
    return math.hypot(ax - bx, az - bz)


async def get_region_out(db: AsyncSession, region_id: str) -> RegionOut | None:
    region = (
        await db.execute(select(WorldRegion).where(WorldRegion.id == region_id))
    ).scalar_one_or_none()
    if not region:
        return None

    entities = (
        (await db.execute(select(WorldEntity).where(WorldEntity.region_id == region.id)))
        .scalars()
        .all()
    )
    businesses = {
        b.entity_id: b
        for b in (
            await db.execute(select(Business).where(Business.entity_id.in_([e.id for e in entities] or ["-"])))
        ).unique().scalars()
    }
    npcs = {
        n.world_entity_id: n
        for n in (
            await db.execute(select(NPCAgent).where(NPCAgent.world_entity_id.in_([e.id for e in entities] or ["-"])))
        ).scalars()
    }

    outs = []
    for e in entities:
        biz = businesses.get(e.id)
        npc = npcs.get(e.id)
        outs.append(
            EntityOut(
                id=e.id,
                code=e.code,
                name=e.name,
                entity_type=e.entity_type,
                position=(e.position_x, e.position_y, e.position_z),
                rotation=e.rotation,
                interaction_radius=e.interaction_radius,
                is_active=e.is_active,
                business_id=biz.id if biz else None,
                npc_agent_code=npc.code if npc else None,
                metadata=e.metadata_json or {},
            )
        )
    return RegionOut(
        id=region.id,
        name=region.name,
        slug=region.slug,
        description=region.description,
        entities=outs,
    )


async def get_region_by_slug(db: AsyncSession, slug: str) -> WorldRegion | None:
    return (
        await db.execute(select(WorldRegion).where(WorldRegion.slug == slug))
    ).scalar_one_or_none()


async def validate_interaction(
    db: AsyncSession, player_id: str, entity_id: str, px: float, py: float, pz: float
) -> InteractionOut:
    """Validate that a player is close enough to interact with an entity.

    The server never trusts client-side distance claims; positions come from
    the authoritative player_state or the WS move stream (rate-limited).
    """
    entity = (
        await db.execute(select(WorldEntity).where(WorldEntity.id == entity_id))
    ).scalar_one_or_none()
    if entity is None or not entity.is_active:
        raise LookupError("entity_not_found")

    d = distance(px, pz, entity.position_x, entity.position_z)
    allowed = max(entity.interaction_radius, settings.interaction_radius)
    if d > allowed:
        raise PermissionError("too_far_from_entity")

    options: list[InteractionOption] = []
    biz = (
        await db.execute(select(Business).where(Business.entity_id == entity.id))
    ).unique().scalar_one_or_none()
    npc = (
        await db.execute(select(NPCAgent).where(NPCAgent.world_entity_id == entity.id))
    ).scalar_one_or_none()

    if biz and biz.status == "open":
        if biz.business_type == "shop":
            options.append(
                InteractionOption(
                    kind="shop", label=f"Browse {biz.name}", business_id=biz.id,
                    npc_agent_code=npc.code if npc else None,
                )
            )
            options.append(
                InteractionOption(
                    kind="job_board", label="Ask about delivery work", business_id=biz.id,
                    npc_agent_code=npc.code if npc else None,
                )
            )
        elif biz.business_type == "pos":
            options.append(
                InteractionOption(kind="pos_kiosk", label="Use Lightning POS kiosk", business_id=biz.id)
            )
    elif biz and biz.status != "open":
        options.append(
            InteractionOption(kind="dialogue", label=f"{biz.name} is closed ({biz.status.replace('_', ' ')})")
        )
    if entity.entity_type == "market":
        options.append(InteractionOption(kind="dialogue", label="Haggle with market vendors"))
    elif entity.entity_type == "landmark":
        options.append(InteractionOption(kind="landmark", label=f"Look around {entity.name}"))
    elif entity.entity_type == "transport_stop":
        options.append(InteractionOption(kind="transport", label="Check keke routes (coming soon)"))
    if npc and not options:
        options.append(
            InteractionOption(kind="dialogue", label=f"Talk to {npc.name}", npc_agent_code=npc.code)
        )
    if not options:
        options.append(InteractionOption(kind="dialogue", label=f"Look at {entity.name}"))

    return InteractionOut(entity_id=entity.id, entity_name=entity.name, options=options)
