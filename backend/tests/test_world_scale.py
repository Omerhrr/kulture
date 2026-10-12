"""World scale: seeded positions, bounds and the boot-time reconcile.

The frontend stretches the OSM map by WORLD_SCALE (frontend/app/utils/
kaduna.ts); the backend must agree, and databases seeded at an older scale
must be healed on boot without duplicating anything.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.config import settings, world_bounds
from app.seed.seed_data import ENTITIES, reconcile_world_scale


def test_world_bounds_follow_scale():
    xmin, xmax, zmin, zmax = world_bounds()
    rx0, rx1, rz0, rz1 = settings.world_raw_bounds
    k = settings.world_scale
    assert (xmin, xmax, zmin, zmax) == (rx0 * k, rx1 * k, rz0 * k, rz1 * k)
    # every playable spot is inside the playable rectangle
    for _code, _n, _t, x, z, _r, _rad in ENTITIES:
        assert xmin <= x * k <= xmax
        assert zmin <= z * k <= zmax


@pytest.mark.asyncio
async def test_seeded_entities_are_scaled():
    from app.db.session import AsyncSessionLocal
    from app.models.world import WorldEntity

    k = settings.world_scale
    async with AsyncSessionLocal() as db:
        for code, _n, _t, x, z, _r, _rad in ENTITIES:
            e = (await db.execute(select(WorldEntity).where(WorldEntity.code == code))).scalar_one()
            assert e.position_x == pytest.approx(x * k)
            assert e.position_z == pytest.approx(z * k)


@pytest.mark.asyncio
async def test_reconcile_heals_old_scale_and_is_idempotent():
    from app.db.session import AsyncSessionLocal
    from app.models.player import PlayerState
    from app.models.world import WorldEntity

    k = settings.world_scale
    async with AsyncSessionLocal() as db:
        # simulate a database written by the old 1:10 build
        shop = (await db.execute(select(WorldEntity).where(WorldEntity.code == "musa_shop"))).scalar_one()
        shop.position_x, shop.position_z = -70.0, 75.0
        await db.commit()

        changed = await reconcile_world_scale(db)
        assert changed >= 1

        shop = (await db.execute(select(WorldEntity).where(WorldEntity.code == "musa_shop"))).scalar_one()
        raw = next(e for e in ENTITIES if e[0] == "musa_shop")
        assert shop.position_x == pytest.approx(raw[3] * k)
        assert shop.position_z == pytest.approx(raw[4] * k)
        # stale player positions are reset to the spawn
        spawn = next(e for e in ENTITIES if e[0] == "spawn_roadside")
        for ps in (await db.execute(select(PlayerState))).scalars().all():
            assert ps.position_x == pytest.approx(spawn[3] * k)
            assert ps.position_z == pytest.approx(spawn[4] * k)

        # second run: nothing left to do
        assert await reconcile_world_scale(db) == 0
