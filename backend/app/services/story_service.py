"""Main story: "Musa's Promise".

You arrive in Kaduna with a letter for Mallam Musa. Each chapter is given
by one of the city's people (talk to them, server-checked on site) and is
usually a delivery that is yours alone: a per-player job on the normal
pickup / deliver flow, so the shared job board never runs dry for the next
player. The receiver of one chapter gives the next, so the story walks you
across the map: the market, the river, the campus, the motor park, the
station and Sabon Tasha, and ends with your own shop.

Every place and person here is a seeded world entity (seed_data ENTITIES /
NEW_ENTITIES) and a member of the frontend cast (utils/cast.ts).
"""

from __future__ import annotations

import asyncio
import math
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.events import OutboxEvent
from app.models.jobs import Job
from app.models.ledger import GameLedgerEntry
from app.models.story import StoryProgress
from app.models.world import WorldEntity
from app.services import life_service, player_service

# how close you must stand to a giver (or their shop) to be given a chapter
TALK_RADIUS = 15.0
# Musa's stake toward your first shop (the finale); the rest you earn
SHOP_GRANT_KSATS = 10_000_000


class StoryError(Exception):
    pass


@dataclass(frozen=True)
class Chapter:
    key: str
    title: str
    summary: str
    giver: str  # entity code of the person who gives it
    lines: list[str]  # what they say when they give it
    kind: str = "delivery"  # meet | delivery | business
    pickup: str | None = None
    dropoff: str | None = None
    parcel: str = ""
    reward_ksats: int = 0
    reward_rep: int = 0
    done_lines: list[str] = field(default_factory=list)  # the receiver, on delivery


CHAPTERS: list[Chapter] = [
    Chapter(
        key="letter",
        title="The Letter",
        summary="Your aunty sent you to Kaduna with a letter for Mallam Musa.",
        giver="npc_musa",
        kind="meet",
        lines=[
            "Sannu, sannu! Ah - this is Aunty Hauwa's handwriting.",
            "She says you are hardworking and you need a start. Kaduna rewards people who move.",
            "Stay close. I have work for you this very minute.",
        ],
    ),
    Chapter(
        key="first_run",
        title="First Run",
        summary="Musa's first errand: a sealed package for Hajiya Amina at Stonetech Square.",
        giver="npc_musa",
        pickup="musa_shop",
        dropoff="stonetech_square",
        parcel="a sealed package of suya spice",
        reward_ksats=800_000,
        reward_rep=5,
        lines=[
            "Hajiya Amina at Stonetech Square, by the stadium, is waiting on this package.",
            "It's about 800 metres south. Take the keke or a car if your legs are lazy.",
            "Pick it up at my counter, then go. Don't shake it!",
        ],
        done_lines=["Musa sent you? Then you're family. Nagode!"],
    ),
    Chapter(
        key="river",
        title="Across the River",
        summary="Bring Mama Chidi's wax print from the Textile Market back to Musa.",
        giver="npc_amina",
        pickup="textile_market",
        dropoff="musa_shop",
        parcel="six bolts of wax print",
        reward_ksats=900_000,
        reward_rep=6,
        lines=[
            "Before you go back - Musa phoned. Mama Chidi has his wax print ready.",
            "The Textile Market is across the river. Take Junction Road over the Coronation Bridge and keep south.",
            "Collect it from Mama Chidi and bring it to his store. He'll be pleased.",
        ],
        done_lines=["Mama Chidi's wax! Customers have been asking all week. Well done."],
    ),
    Chapter(
        key="campus",
        title="Books for the Professor",
        summary="Deliver a box of textbooks to Professor Danjuma at the KASU main gate.",
        giver="npc_musa",
        pickup="musa_shop",
        dropoff="kasu_gate",
        parcel="a box of economics textbooks",
        reward_ksats=600_000,
        reward_rep=5,
        lines=[
            "Professor Danjuma ordered textbooks for his students. KASU main gate, east across town.",
            "He'll talk your ear off about sats. Listen - the man is usually right.",
        ],
        done_lines=["Ah, the books! Scarcity, incentives, sats - my students will read them twice."],
    ),
    Chapter(
        key="kawo",
        title="The Kawo Connection",
        summary="Take the professor's donated books to Bashir at Kawo Motor Park.",
        giver="npc_prof_danjuma",
        pickup="kasu_gate",
        dropoff="kawo_motor_park",
        parcel="donated books for the motor park's evening class",
        reward_ksats=750_000,
        reward_rep=6,
        lines=[
            "One more favour. Bashir at Kawo Motor Park runs an evening class for the drivers' children.",
            "These books are for them. Kawo is far north - past the Sultan Bello Mosque. Take a keke.",
        ],
        done_lines=["Books for the children? You are a good person. Kai, Kaduna needs more like you."],
    ),
    Chapter(
        key="train",
        title="The Evening Train",
        summary="Carry Mama Chidi's fabric load to Tunde at Rigasa Station before the train leaves.",
        giver="npc_bashir",
        pickup="textile_market",
        dropoff="rigasa_station",
        parcel="a long-haul load of fabric",
        reward_ksats=1_600_000,
        reward_rep=9,
        lines=[
            "You know Mama Chidi? Good. Her fabric must reach Tunde at Rigasa Station for the evening train.",
            "It's a long road: south over the river to her, then out west to Rigasa. Take a car, abeg.",
        ],
        done_lines=["Waybill checked, twice. Seventeen minutes before departure. Respect."],
    ),
    Chapter(
        key="sabon_tasha",
        title="Sabon Tasha Sunrise",
        summary="Ride Ngozi's fresh tomatoes from Sabon Tasha to the Central Market traders.",
        giver="npc_tunde",
        pickup="sabon_tasha_shop",
        dropoff="kaduna_central_market",
        parcel="baskets of fresh tomatoes",
        reward_ksats=1_100_000,
        reward_rep=7,
        lines=[
            "The morning train brought a message: Ngozi in Sabon Tasha needs a rider for her tomatoes.",
            "Central Market traders want them while the dew is still on them. Ride fast, ride safe.",
        ],
        done_lines=[],
    ),
    Chapter(
        key="own_shop",
        title="Your Own Sign",
        summary="Musa stakes you toward your own shop. Open it and the city is yours.",
        giver="npc_musa",
        kind="business",
        lines=[
            "The whole city is talking about you - Amina, Chidi, the professor, Bashir, Tunde, Ngozi.",
            "Aunty Hauwa was right. It's time you had your own sign above a door.",
            "Here: ten million k-sats toward a shop. The rest you earn with honest shifts.",
            "First get your own flat - no landlord rents a shop to someone in their aunty's parlour. Then: Phone, Business. Go!",
        ],
    ),
]
BY_KEY = {c.key: c for c in CHAPTERS}


# ---------------------------------------------------------------- helpers
async def _entity(db: AsyncSession, code: str) -> WorldEntity | None:
    return (await db.execute(select(WorldEntity).where(WorldEntity.code == code))).scalar_one_or_none()


async def _progress(db: AsyncSession, player_id: str) -> StoryProgress:
    p = await db.get(StoryProgress, player_id)
    if p is None:
        p = StoryProgress(player_id=player_id, chapter=0, started=False, log=[])
        db.add(p)
        await db.flush()
    return p


async def _near(db: AsyncSession, player_id: str, codes: list[str]) -> bool:
    st = await player_service.player_state(db, player_id)
    for code in codes:
        e = await _entity(db, code)
        if e is not None and math.hypot(st.position_x - e.position_x, st.position_z - e.position_z) <= TALK_RADIUS + e.interaction_radius:
            return True
    return False


# the giver's workplace counts as "with them" (the shop counter, the stall)
POSTS = {
    "npc_musa": "musa_shop",
    "npc_amina": "stonetech_square",
    "npc_mama_chidi": "textile_market",
    "npc_bashir": "kawo_motor_park",
    "npc_prof_danjuma": "kasu_gate",
    "npc_tunde": "rigasa_station",
    "npc_ngozi": "sabon_tasha_shop",
}


def _finish(p: StoryProgress, ch: Chapter) -> None:
    p.log = [*(p.log or []), {"key": ch.key, "at": datetime.now(timezone.utc).isoformat()}]
    p.chapter += 1
    p.started = False
    p.job_id = None
    if p.chapter >= len(CHAPTERS):
        p.finished_at = datetime.now(timezone.utc)


async def _give_job(db: AsyncSession, player_id: str, ch: Chapter) -> Job:
    pickup = await _entity(db, ch.pickup or "")
    dropoff = await _entity(db, ch.dropoff or "")
    if pickup is None or dropoff is None:
        raise StoryError("story_place_missing")
    job = Job(
        code=f"story-{ch.key}-{player_id[:8]}-{uuid.uuid4().hex[:6]}",
        job_type="delivery",
        title=f"{ch.title}: {ch.parcel[:1].upper()}{ch.parcel[1:]}",
        description=f"{ch.summary} Pick up at {pickup.name}, deliver to {dropoff.name}.",
        issuer_business_id=None,
        assignee_player_id=player_id,
        status="assigned",
        pickup_entity_id=pickup.id,
        dropoff_entity_id=dropoff.id,
        reward_ksats=ch.reward_ksats,
        reward_reputation=ch.reward_rep,
        accepted_at=datetime.now(timezone.utc),
        payload={"story": ch.key},
    )
    db.add(job)
    await db.flush()
    db.add(OutboxEvent(event_type="job.updated", aggregate_id=job.id, player_id=player_id, payload={"job_id": job.id, "status": job.status}))
    return job


async def _advance(db: AsyncSession, player_id: str, p: StoryProgress) -> list[dict[str, Any]]:
    """Close chapters whose goal is met (delivered, shop opened). Returns
    what the receivers say, once."""
    said: list[dict[str, Any]] = []
    while p.chapter < len(CHAPTERS) and p.started:
        ch = CHAPTERS[p.chapter]
        if ch.kind == "delivery":
            job = await db.get(Job, p.job_id) if p.job_id else None
            if job is None:
                # lost (should not happen): the giver hands it over again
                p.started = False
                break
            if job.status != "completed":
                break
            if ch.done_lines:
                said.append({"speaker": _receiver(ch), "lines": ch.done_lines})
        elif ch.kind == "business":
            st = await life_service.life_state(db, player_id)
            if not st.business_kind:
                break
            said.append({"speaker": "npc_musa", "lines": ["A shop with your name on it. Aunty Hauwa will cry. Kaduna is yours now."]})
        _finish(p, ch)
    return said


def _receiver(ch: Chapter) -> str | None:
    """The person at the drop-off (their post is the drop-off entity)."""
    for npc, post in POSTS.items():
        if post == ch.dropoff:
            return npc
    return None


async def _out(db: AsyncSession, player_id: str, p: StoryProgress, said: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(CHAPTERS)
    base: dict[str, Any] = {"chapter": p.chapter, "total": total, "done": p.chapter >= total, "said": said, "log": [x["key"] for x in (p.log or [])]}
    if p.chapter >= total:
        return {**base, "title": "Kaduna is yours", "summary": "You finished the story. Chase your dream, build your business, live your life.", "step": "free", "target": None}
    ch = CHAPTERS[p.chapter]
    out = {**base, "key": ch.key, "title": ch.title, "summary": ch.summary, "giver": ch.giver, "job_id": p.job_id}
    if not p.started:
        return {**out, "step": "talk", "target": ch.giver}
    if ch.kind == "business":
        st = await life_service.life_state(db, player_id)
        have = await player_service.ksats_balance(db, player_id)
        price = min(v[1] for v in life_service.BUSINESSES.values())
        # open_business also wants you out of the family house, or certified
        ready = st.housing != "family" or "business_admin" in await life_service.certificates(db, player_id)
        return {**out, "step": "business", "target": None, "have_ksats": have, "need_ksats": price, "ready": ready, "owned": bool(st.business_kind)}
    job = await db.get(Job, p.job_id) if p.job_id else None
    if job is not None and job.status == "in_progress":
        return {**out, "step": "deliver", "target": ch.dropoff, "receiver": _receiver(ch), "parcel": ch.parcel}
    return {**out, "step": "pickup", "target": ch.pickup, "parcel": ch.parcel}


# ---------------------------------------------------------------- API
async def state(db: AsyncSession, player_id: str) -> dict[str, Any]:
    p = await _progress(db, player_id)
    said = await _advance(db, player_id, p)
    await db.commit()
    return await _out(db, player_id, p, said)


# one talk at a time per player: a double tap must not hand out a chapter
# (or Musa's stake) twice
_talk_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


async def talk(db: AsyncSession, player_id: str, npc: str) -> dict[str, Any]:
    """You spoke to `npc` (an entity code). If they give the current chapter
    and you are with them, they give it (and a following chapter of theirs,
    if the current one was only a meeting)."""
    async with _talk_locks[player_id]:
        return await _talk(db, player_id, npc)


async def _talk(db: AsyncSession, player_id: str, npc: str) -> dict[str, Any]:
    p = await _progress(db, player_id)
    said = await _advance(db, player_id, p)
    while p.chapter < len(CHAPTERS):
        ch = CHAPTERS[p.chapter]
        if p.started or ch.giver != npc:
            break
        if not await _near(db, player_id, [npc, POSTS.get(npc, npc)]):
            raise StoryError("too_far_from_giver")
        said.append({"speaker": npc, "lines": ch.lines})
        if ch.kind == "meet":
            _finish(p, ch)
            continue
        p.started = True
        if ch.kind == "delivery":
            p.job_id = (await _give_job(db, player_id, ch)).id
        elif ch.kind == "business":
            db.add(GameLedgerEntry(
                account_reference=f"player:{player_id}", asset_type="ksats", amount_minor_units=SHOP_GRANT_KSATS,
                transaction_reference=f"story_grant:{ch.key}:{player_id}", entry_type="story_reward",
                description="Mallam Musa's stake toward your shop",
            ))
        said.extend(await _advance(db, player_id, p))
        break
    await db.commit()
    return await _out(db, player_id, p, said)
