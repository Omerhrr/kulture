"""World + interaction routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import error, get_current_profile
from app.db.session import get_db
from app.models.player import PlayerProfile
from app.schemas.game import InteractionIn, InteractionOut, RegionOut
from app.services import player_service, world_service

router = APIRouter(tags=["world"])


@router.get("/world/regions/{region_id}", response_model=RegionOut)
async def get_region(
    region_id: str,
    profile: PlayerProfile = Depends(get_current_profile),
    db: AsyncSession = Depends(get_db),
) -> RegionOut:
    region = await world_service.get_region_out(db, region_id)
    if not region:
        by_slug = await world_service.get_region_by_slug(db, region_id)
        region = await world_service.get_region_out(db, by_slug.id) if by_slug else None
    if not region:
        raise error("region_not_found", "Unknown region.", 404)
    return region


@router.post("/interactions", response_model=InteractionOut)
async def interact(
    body: InteractionIn,
    profile: PlayerProfile = Depends(get_current_profile),
    db: AsyncSession = Depends(get_db),
) -> InteractionOut:
    try:
        return await world_service.validate_interaction(
            db, profile.id, body.entity_id, *body.position
        )
    except LookupError:
        raise error("entity_not_found", "That entity does not exist.", 404)
    except PermissionError as exc:
        raise error("too_far", str(exc), 422)
