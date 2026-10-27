"""The world tells one story: named people are distinct, seeded texts match
the map, and older databases are brought in line on boot."""

from __future__ import annotations

import uuid

from sqlalchemy import select

from app.core.config import settings
from app.seed.seed_data import ENTITIES, JOB_DEFS, NEW_ENTITIES, NPC_DEFS, refresh_seed_text
from app.services.social_service import PERSONAS, PERSONA_RENAMES, migrate_persona_ids

# NOTE: asyncio_mode = auto (pytest.ini) collects the async tests.

STORY_NPCS = {code for code, _n, etype, *_ in [*ENTITIES, *NEW_ENTITIES] if etype == "npc"}


def _first_name(full: str) -> str:
    for title in ("Mallam ", "Hajiya ", "Mama ", "Professor "):
        full = full.removeprefix(title)
    return full.split()[0]


def test_dating_personas_are_not_story_characters():
    # no shared ids: a relationship with a persona is never one with them
    assert not STORY_NPCS & set(PERSONAS)
    # no shared first names either (the phone would show "Musa, developer"
    # next to Mallam Musa the shopkeeper)
    story_names = {_first_name(name) for code, name, etype, *_ in [*ENTITIES, *NEW_ENTITIES] if etype == "npc"}
    story_names |= {_first_name(name) for _c, name, *_ in NPC_DEFS}
    assert not story_names & {p["name"] for p in PERSONAS.values()}
    for p in PERSONAS.values():
        assert p["gender"] in ("female", "male")


def test_job_directions_match_the_map():
    """+z is south, -z north (utils/kaduna.ts). Each job that names a
    direction must agree with where the drop-off really is."""
    pos = {code: (x, z) for code, _n, _t, x, z, *_ in [*ENTITIES, *NEW_ENTITIES]}
    words = {"north": lambda dx, dz: dz < 0, "south": lambda dx, dz: dz > 0, "east": lambda dx, dz: dx > 0, "west": lambda dx, dz: dx < 0}
    for code, _title, desc, _biz, pickup, dropoff, *_ in JOB_DEFS:
        (px, pz), (dx, dz) = pos[pickup], pos[dropoff]
        text = desc.lower()
        for word, ok in words.items():
            # "north-east" counts as both
            if f"{word} " in text or f"{word}-" in text or f"-{word}" in text or f"{word}." in text or f"{word}," in text:
                assert ok(dx - px, dz - pz), f"{code}: says {word!r}"


async def test_persona_relationships_migrate_to_new_ids():
    from app.db.session import AsyncSessionLocal
    from app.models.life import Relationship

    pid = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        # an old save: dating Musa the developer, and a talk with the real
        # shopkeeper agent (different id; must not be touched)
        db.add(Relationship(id=str(uuid.uuid4()), player_id=pid, other_kind="npc", other_id="npc_musa", name="Musa",
                            friendship=40, romance=20, status="friend", memory=["Met"], date_state={}))
        db.add(Relationship(id=str(uuid.uuid4()), player_id=pid, other_kind="npc", other_id="kaduna_shopkeeper_001",
                            name="Mallam Musa", friendship=10, romance=0, status="acquaintance", memory=[], date_state={}))
        await db.commit()
        assert await migrate_persona_ids(db) >= 1
        rows = {r.other_id: r for r in (await db.execute(select(Relationship).where(Relationship.player_id == pid))).scalars()}
        new_id, new_name = PERSONA_RENAMES["npc_musa"][1:]
        assert set(rows) == {new_id, "kaduna_shopkeeper_001"}
        assert rows[new_id].name == new_name and rows[new_id].romance == 20
        assert rows["kaduna_shopkeeper_001"].name == "Mallam Musa"
        assert await migrate_persona_ids(db) == 0


async def test_refresh_seed_text_heals_old_names_and_jobs():
    from app.db.session import AsyncSessionLocal
    from app.models.jobs import Job
    from app.models.world import WorldEntity

    async with AsyncSessionLocal() as db:
        sq = (await db.execute(select(WorldEntity).where(WorldEntity.code == "stonetech_square"))).scalar_one()
        sq.name = "Stonetech Square, Barnawa"  # the old (wrong-district) name
        job = (await db.execute(select(Job).where(Job.code == "deliv-rigasa-kawo-0007"))).scalar_one()
        job.description = "... Kawo Motor Park union point, south across the river."
        await db.commit()
        assert await refresh_seed_text(db) >= 2
        await db.refresh(sq)
        await db.refresh(job)
        assert "Barnawa" not in sq.name
        assert "south" not in job.description
        assert await refresh_seed_text(db) == 0


def test_entity_positions_scale_inside_world():
    k = settings.world_scale
    xmin, xmax, zmin, zmax = (b * k for b in settings.world_raw_bounds)
    for _code, _n, _t, x, z, *_ in NEW_ENTITIES:
        assert xmin <= x * k <= xmax and zmin <= z * k <= zmax
