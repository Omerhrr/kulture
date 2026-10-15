"""World + interaction routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import error, get_current_profile
from app.core.config import settings
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
    # P1 hardening: the distance check uses the SERVER-STORED position, not
    # the client-supplied one - a POST can no longer fabricate proximity.
    # (body.position is accepted for protocol compatibility only; flip
    # settings.interactions_use_server_position off to restore legacy behavior.)
    if settings.interactions_use_server_position:
        state = await player_service.player_state(db, profile.id)
        px, py, pz = state.position_x, state.position_y, state.position_z
    else:
        px, py, pz = body.position
    try:
        return await world_service.validate_interaction(db, profile.id, body.entity_id, px, py, pz)
    except LookupError:
        raise error("entity_not_found", "That entity does not exist.", 404)
    except PermissionError as exc:
        raise error("too_far", str(exc), 422)


# ------------------------------------------------------------ Kaduna State towns
from pydantic import BaseModel as _BM  # noqa: E402

from app.services import travel_service  # noqa: E402


class TravelIn(_BM):
    region: str


@router.get("/world/towns")
async def towns(profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict:
    cur = travel_service.SLUG_TO_ID.get(await travel_service.region_of(db, profile.id), "kaduna")
    return {"current": cur, "towns": travel_service.towns_out(cur)}


@router.post("/world/travel")
async def travel(body: TravelIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict:
    try:
        out = await travel_service.travel(db, profile.id, body.region)
    except travel_service.TravelError as e:
        msg = {"unknown_town": "That town isn't on the map.", "already_there": "You're already there.", "insufficient_funds": "Not enough naira for the fare."}
        raise error(str(e), msg.get(str(e), str(e)), 409 if str(e) != "unknown_town" else 404)
    from app.events.presence import presence

    presence.join(profile.id, profile.display_name, out["position"], out["slug"])
    return out
