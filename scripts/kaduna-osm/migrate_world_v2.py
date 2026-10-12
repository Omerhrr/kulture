#!/usr/bin/env python3
"""One-time migration: move the world to the full Kaduna city map.

- Updates every seeded world_entity to its new OSM-derived position.
- Renames the region to "Kaduna City".
- Resets every player to the new spawn on Ahmadu Bello Way (old persisted
  positions point at the retired compact neighborhood layout).

Idempotent: safe to run again. Uses the backend app settings for the DB URL.
"""

import asyncio
import sys

import os as _os
_REPO = _os.path.abspath(_os.path.join(_os.path.dirname(__file__), "..", ".."))
# raw OSM extracts live outside the repo by default; override with KK_OSM_RAW
_RAW_DEFAULT = _os.environ.get("KK_OSM_RAW", _os.path.join(_REPO, "..", "kaduna-osm-raw"))
sys.path.insert(0, _os.path.join(_REPO, "backend"))

from sqlalchemy import select, update  # noqa: E402

from app.db.session import AsyncSession, engine  # noqa: E402
from app.models.player import PlayerState  # noqa: E402
from app.models.world import WorldEntity, WorldRegion  # noqa: E402

# code -> (x, z, name or None to keep). These are RAW bake units; since the
# WORLD_SCALE change the backend rescales them on boot (reconcile_world_scale).
ENTITIES = {
    "spawn_roadside": (-98.0, 40.0, "Ahmadu Bello Way - Roadside Spawn"),
    "musa_shop": (-70.0, 75.0, None),
    "arewa_pos": (-25.0, 8.0, None),
    "kaduna_central_market": (-80.0, 102.0, None),
    "arewa_house": (-20.0, -164.0, None),
    "stonetech_square": (-55.0, 360.0, "Stonetech Square, Barnawa"),
    "keke_stop": (-245.0, 420.0, "Keke Napep Stop, Kaduna Junction"),
    "npc_musa": (-74.0, 70.0, None),
    "npc_amina": (-60.0, 355.0, None),
}

RADII = {"musa_shop": 10.0, "arewa_pos": 6.0, "keke_stop": 8.0}

SPAWN = ENTITIES["spawn_roadside"][:2]


async def main() -> None:
    async with AsyncSession(engine) as db:
        # region rename
        regions = (await db.execute(select(WorldRegion))).scalars().all()
        for r in regions:
            r.name = "Kaduna City"
            r.slug = "kaduna-city"
            r.description = (
                "The full city map: River Kaduna, Ahmadu Bello Way, Murtala "
                "Square, Kaduna Central Market, Barnawa, Kakuri, Kawo, Rigasa, "
                "the airport and more. Manually modeled, approximate layout "
                "reconciled with OpenStreetMap - not survey data."
            )
            print(f"region renamed: {r.id}")

        # entity repositioning
        for code, (x, z, name) in ENTITIES.items():
            entity = (
                await db.execute(select(WorldEntity).where(WorldEntity.code == code))
            ).scalar_one_or_none()
            if entity is None:
                print(f"  !! missing entity: {code}")
                continue
            entity.position_x = x
            entity.position_z = z
            if name:
                entity.name = name
            if code in RADII:
                entity.interaction_radius = RADII[code]
            print(f"  {code}: -> ({x}, {z})")

        # reset players to the new spawn (old positions are from the retired map)
        res = await db.execute(
            update(PlayerState).values(position_x=SPAWN[0], position_y=0.0, position_z=SPAWN[1])
        )
        print(f"player states reset to spawn: {res.rowcount}")
        await db.commit()
    await engine.dispose()
    print("migration complete")


if __name__ == "__main__":
    asyncio.run(main())
