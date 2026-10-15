"""Kaduna State towns + road travel between them.

Each town is its own map (frontend bakes). A trip is a shared-taxi ride on
the real highway: you pay the fare and arrive at that town's motor park
side of the market. The server is the authority on which town you are in."""

from __future__ import annotations

import json
import os
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.player import PlayerState
from app.models.world import WorldRegion, WorldEntity
from app.services import life_service

_TOWNS = json.load(open(os.path.join(os.path.dirname(__file__), "..", "data", "towns.json")))

# id -> slug, name, km from Kaduna, fare (kobo), highway
REGIONS: dict[str, dict[str, Any]] = {
    "kaduna": {"slug": "kaduna-city", "name": "Kaduna", "km": 0, "fare": 0, "highway": ""},
    "zaria": {"slug": "zaria", "name": "Zaria", "km": 80, "fare": 250_000, "highway": "Kaduna-Zaria Expressway"},
    "kachia": {"slug": "kachia", "name": "Kachia", "km": 90, "fare": 220_000, "highway": "Kaduna-Kachia Road"},
    "saminaka": {"slug": "saminaka", "name": "Saminaka", "km": 140, "fare": 300_000, "highway": "Kaduna-Jos Road"},
    "birnin_gwari": {"slug": "birnin-gwari", "name": "Birnin Gwari", "km": 130, "fare": 300_000, "highway": "Kaduna-Birnin Gwari Road"},
    "zonkwa": {"slug": "zonkwa", "name": "Zonkwa", "km": 170, "fare": 380_000, "highway": "Kachia-Kafanchan Road"},
    "kafanchan": {"slug": "kafanchan", "name": "Kafanchan", "km": 200, "fare": 420_000, "highway": "Kaduna-Kafanchan Road"},
}
SLUG_TO_ID = {v["slug"]: k for k, v in REGIONS.items()}


class TravelError(Exception):
    pass


async def ensure_regions(db: AsyncSession) -> None:
    """World region rows for every town (idempotent, run at boot)."""
    have = {r.slug for r in (await db.execute(select(WorldRegion))).scalars().all()}
    for rid, r in REGIONS.items():
        if r["slug"] in have:
            continue
        db.add(WorldRegion(name=r["name"], slug=r["slug"], description=f"{r['name']}, Kaduna State - authored town map (approximate).", map_metadata={"town": rid}))
    await db.commit()


async def region_of(db: AsyncSession, player_id: str) -> str:
    st = (await db.execute(select(PlayerState).where(PlayerState.player_id == player_id))).scalar_one_or_none()
    if not st:
        return "kaduna-city"
    reg = await db.get(WorldRegion, st.region_id)
    return reg.slug if reg else "kaduna-city"


def fare_between(a: str, b: str) -> int:
    if a == b:
        return 0
    fa, fb = REGIONS[a]["fare"], REGIONS[b]["fare"]
    # town -> town goes back through Kaduna's motor parks
    return fb if a == "kaduna" else fa if b == "kaduna" else fa + fb


async def travel(db: AsyncSession, player_id: str, dest: str) -> dict[str, Any]:
    if dest not in REGIONS:
        raise TravelError("unknown_town")
    cur = SLUG_TO_ID.get(await region_of(db, player_id), "kaduna")
    if cur == dest:
        raise TravelError("already_there")
    fare = fare_between(cur, dest)
    try:
        await life_service.charge(db, player_id, fare, "travel_fare", f"Shared taxi {REGIONS[cur]['name']} → {REGIONS[dest]['name']}")
    except life_service.LifeError:
        raise TravelError("insufficient_funds")
    region = (await db.execute(select(WorldRegion).where(WorldRegion.slug == REGIONS[dest]["slug"]))).scalar_one()
    if dest == "kaduna":
        spawn = (await db.execute(select(WorldEntity).where(WorldEntity.code == "kawo_motor_park"))).scalar_one_or_none() or (
            await db.execute(select(WorldEntity).where(WorldEntity.code == "spawn_roadside"))
        ).scalar_one()
        pos = [spawn.position_x + 6, 0.0, spawn.position_z + 6]
    else:
        pos = list(_TOWNS[dest]["spawn"])
    st = (await db.execute(select(PlayerState).where(PlayerState.player_id == player_id))).scalar_one()
    st.region_id = region.id
    st.position_x, st.position_y, st.position_z = pos
    st.state_version += 1
    await db.commit()
    return {"region": dest, "slug": REGIONS[dest]["slug"], "position": pos, "fare": fare, "from": cur}


def towns_out(cur: str) -> list[dict[str, Any]]:
    return [{"id": k, **v, "fare_from_here": fare_between(cur, k), "here": k == cur} for k, v in REGIONS.items()]
