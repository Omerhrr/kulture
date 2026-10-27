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

from sqlalchemy import func, select
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
    kind: str = "delivery"  # meet | delivery | business | shelf | win | shift
    pickup: str | None = None
    dropoff: str | None = None
    parcel: str = ""
    reward_ksats: int = 0
    reward_rep: int = 0
    done_lines: list[str] = field(default_factory=list)  # the receiver (delivery) or giver, when it's done
    need: int = 0  # shelf: products on your shelves
    game: str = ""  # win: which game (Phone → Games)
    act: int = 1


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
    # ============================ Act 2: Kaduna Rising ============================
    Chapter(
        key="shelves",
        act=2,
        title="Stock the Shelves",
        summary="Mama Chidi has advice for a new shopkeeper: put at least three products on your shelves.",
        giver="npc_mama_chidi",
        kind="shelf",
        need=3,
        reward_ksats=500_000,
        lines=[
            "Musa told me! A shop of your own. Come, let me tell you what thirty years in this market taught me.",
            "A shop with empty shelves is a church with no choir. Put at least three things on your shelves.",
            "Phone, Business, Shelves. Buy from the wholesalers, price it fair, and people will come.",
        ],
        done_lines=["Ehen! Now that is a shop. Here, small something to celebrate - don't spend it on nonsense."],
    ),
    Chapter(
        key="wager",
        act=2,
        title="The Professor's Wager",
        summary="Professor Danjuma bets you can't win a game of Naija Trivia. Prove him wrong.",
        giver="npc_prof_danjuma",
        kind="win",
        game="trivia",
        reward_ksats=750_000,
        lines=[
            "A shopkeeper must think fast. Prices, change, customers, all at once.",
            "I'll wager you can't win a round of Naija Trivia. Against my students, against the computer - any table.",
            "Phone, Games, Trivia. Come back a winner and the wager is yours.",
        ],
        done_lines=["You won? Hm. Scarcity of losers today. Fine - a wager is a wager. Here."],
    ),
    Chapter(
        key="spare_parts",
        act=2,
        title="Spare Parts",
        summary="Half the kekes at Kawo are grounded. Fetch Bashir's spare parts from Rigasa Station.",
        giver="npc_bashir",
        pickup="rigasa_station",
        dropoff="kawo_motor_park",
        parcel="a crate of keke spare parts",
        reward_ksats=1_300_000,
        reward_rep=8,
        lines=[
            "Wahala! Half my kekes are grounded - no clutch cables, no plugs.",
            "Tunde has a crate for me at Rigasa Station. Bring it here before the evening rush and my drivers will remember your name.",
        ],
        done_lines=["Cables! Plugs! My boys are back on the road. Anywhere in Kaduna, your fare is on me."],
    ),
    Chapter(
        key="school_fees",
        act=2,
        title="A Day's Work",
        summary="Hajiya Amina's nephew wants to learn what a real day's work looks like. Work one full shift.",
        giver="npc_amina",
        kind="shift",
        reward_ksats=600_000,
        lines=[
            "My nephew Sani thinks money falls from the sky because he sees you riding everywhere.",
            "Show him: work one full shift at any job - Phone, Work. Stay till it's done.",
        ],
        done_lines=["Sani watched the whole thing. He asked me about school fees this morning! Thank you, my dear."],
    ),
    Chapter(
        key="wedding_cloth",
        act=2,
        title="Aso-ebi for Sabon Tasha",
        summary="Ngozi's sister is getting married. Carry the aso-ebi from the Textile Market to Sabon Tasha.",
        giver="npc_ngozi",
        pickup="textile_market",
        dropoff="sabon_tasha_shop",
        parcel="aso-ebi fabric for twelve guests",
        reward_ksats=1_400_000,
        reward_rep=8,
        lines=[
            "My sister's wedding is on Saturday and the aso-ebi is still at Mama Chidi's!",
            "Please - Textile Market, then back here to Sabon Tasha. Twelve guests are waiting to see the colour.",
        ],
        done_lines=["It's beautiful! You'll come to the owambe, abi? Bring dancing shoes."],
    ),
    Chapter(
        key="big_order",
        act=2,
        title="The Big Order",
        summary="The northbound train wants provisions. Carry Musa's biggest order ever to Rigasa Station.",
        giver="npc_tunde",
        pickup="musa_shop",
        dropoff="rigasa_station",
        parcel="Musa's biggest order: provisions for the northbound train",
        reward_ksats=2_500_000,
        reward_rep=12,
        lines=[
            "The northbound train needs provisions for three hundred passengers. I told them one name: Musa.",
            "Collect the order at his store and bring it here. Departure is in ninety minutes. Precisely.",
        ],
        done_lines=["Eighty-four minutes. Six to spare. Mallam Musa will hear about this from me."],
    ),
    Chapter(
        key="blessing",
        act=2,
        title="Mallam's Blessing",
        summary="Go back to where it all started.",
        giver="npc_musa",
        kind="meet",
        reward_ksats=1_000_000,
        lines=[
            "Tunde called. Bashir called. Even the Professor called, and he never calls anybody.",
            "When Aunty Hauwa's letter came, I saw a young person with nothing but a bag. Now look at you.",
            "Kaduna has a place for everyone who moves. Take this - not a loan, a blessing. And come and greet me sometimes.",
        ],
    ),
]
ACT_TITLES = {1: "Musa's Promise", 2: "Kaduna Rising"}
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


def _pay(db: AsyncSession, player_id: str, ch: Chapter) -> None:
    """Rewards for chapters without a delivery job (that pays its own)."""
    if ch.kind != "delivery" and ch.reward_ksats > 0:
        db.add(GameLedgerEntry(
            account_reference=f"player:{player_id}", asset_type="ksats", amount_minor_units=ch.reward_ksats,
            transaction_reference=f"story:{ch.key}:{player_id}", entry_type="story_reward", description=f"Story: {ch.title}",
        ))


def _finish(p: StoryProgress, ch: Chapter) -> None:
    p.log = [*(p.log or []), {"key": ch.key, "at": datetime.now(timezone.utc).isoformat()}]
    p.chapter += 1
    p.started = False
    p.started_at = None
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
        elif ch.kind in ("shelf", "win", "shift"):
            if await _progress_of(db, player_id, p, ch) < 1:
                break
            if ch.done_lines:
                said.append({"speaker": ch.giver, "lines": ch.done_lines})
        _pay(db, player_id, ch)
        _finish(p, ch)
    return said


async def _progress_of(db: AsyncSession, player_id: str, p: StoryProgress, ch: Chapter) -> float:
    """0..1 towards a shelf / win / shift chapter (counted from when it was given)."""
    since = p.started_at or datetime.now(timezone.utc)
    if ch.kind == "shelf":
        from app.models.store import ShelfItem

        n = (await db.execute(select(func.count()).select_from(ShelfItem).where(ShelfItem.owner_id == player_id, ShelfItem.stock > 0))).scalar_one()
        return min(1.0, n / max(1, ch.need))
    if ch.kind == "win":
        from app.models.life import GameMatch

        won = (await db.execute(select(func.count()).select_from(GameMatch).where(
            GameMatch.winner == player_id, GameMatch.game == ch.game, GameMatch.status == "done", GameMatch.updated_at >= since))).scalar_one()
        return 1.0 if won else 0.0
    if ch.kind == "shift":
        from app.models.work import WorkShift

        done = (await db.execute(select(func.count()).select_from(WorkShift).where(
            WorkShift.player_id == player_id, WorkShift.paid_ksats > 0, WorkShift.started_at >= since))).scalar_one()
        return 1.0 if done else 0.0
    return 0.0


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
    out = {**base, "key": ch.key, "title": ch.title, "summary": ch.summary, "giver": ch.giver, "job_id": p.job_id, "act": ch.act, "act_title": ACT_TITLES[ch.act]}
    if not p.started:
        return {**out, "step": "talk", "target": ch.giver}
    if ch.kind == "business":
        st = await life_service.life_state(db, player_id)
        have = await player_service.ksats_balance(db, player_id)
        price = min(v[1] for v in life_service.BUSINESSES.values())
        # open_business also wants you out of the family house, or certified
        ready = st.housing != "family" or "business_admin" in await life_service.certificates(db, player_id)
        return {**out, "step": "business", "target": None, "have_ksats": have, "need_ksats": price, "ready": ready, "owned": bool(st.business_kind)}
    if ch.kind == "shelf":
        from app.models.store import ShelfItem

        n = (await db.execute(select(func.count()).select_from(ShelfItem).where(ShelfItem.owner_id == player_id, ShelfItem.stock > 0))).scalar_one()
        return {**out, "step": "shelf", "target": None, "have": int(n), "need": ch.need}
    if ch.kind == "win":
        return {**out, "step": "win", "target": None, "game": ch.game}
    if ch.kind == "shift":
        return {**out, "step": "shift", "target": None}
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
            _pay(db, player_id, ch)
            _finish(p, ch)
            continue
        p.started = True
        p.started_at = datetime.now(timezone.utc)
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
