"""The deeper life loop: family, running a business, health & fitness, ward
politics (fictional, non-partisan), town activities, crews and gifting.

Everything is server-authoritative and lazy: needs decay is computed from
timestamps when you look, never by a background clock, so it survives
restarts and costs nothing while nobody is online."""

from __future__ import annotations

import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog import Inventory, Item
from app.models.life import Child, Crew, CrewMember, CrewMessage, LifeState, RaceTime, Relationship
from app.models.player import PlayerProfile
from app.services import life_service as ls
from app.services import player_service

GAME_DAY = timedelta(minutes=8)


class SocietyError(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _days_since(dt: datetime | None) -> float:
    d = _aware(dt)
    return 0.0 if d is None else max(0.0, (_now() - d) / GAME_DAY)


async def _charge(db: AsyncSession, pid: str, amount: int, kind: str, desc: str) -> None:
    try:
        await ls.charge(db, pid, amount, kind, desc)
    except ls.LifeError:
        raise SocietyError("insufficient_funds")


# ================================================================== family
BABY_COST = 5_000_000
FEED_COST = 150_000
SCHOOL_FEES = 1_000_000
MAX_KIDS = 4


def _child_tick(c: Child) -> None:
    """Children get hungry (15/day) and bored (8/day). Only whole steps are
    consumed and the clock moves by exactly that much, so checking often
    neither freezes nor speeds up the decay; time away is capped (2 days)."""
    last = _aware(c.cared_at or c.created_at)
    if last is None:
        return
    days = min(2.0, _days_since(last))
    steps = int(days * 15)  # one hunger point per 1/15 day
    if steps < 1:
        return
    c.hunger = max(0, c.hunger - steps)
    c.happiness = max(0, c.happiness - (steps * 8) // 15)
    c.cared_at = max(last + steps / 15 * GAME_DAY, _now() - 2 * GAME_DAY)


def child_out(c: Child) -> dict[str, Any]:
    age_days = int(_days_since(c.created_at))
    return {"id": c.id, "name": c.name, "gender": c.gender, "hunger": c.hunger, "happiness": c.happiness,
            "schooling": c.schooling, "age_days": age_days, "stage": "baby" if age_days < 3 else "child" if age_days < 30 else "teen"}


async def family(db: AsyncSession, pid: str) -> dict[str, Any]:
    kids = (await db.execute(select(Child).where(Child.player_id == pid).order_by(Child.created_at))).scalars().all()
    for k in kids:
        _child_tick(k)
    spouse = (await db.execute(select(Relationship).where(Relationship.player_id == pid, Relationship.status == "married"))).scalars().first()
    await db.commit()
    return {"spouse": spouse.name if spouse else None, "children": [child_out(k) for k in kids],
            "prices": {"baby": BABY_COST, "feed": FEED_COST, "school": SCHOOL_FEES}, "max_children": MAX_KIDS}


async def have_baby(db: AsyncSession, pid: str, name: str, gender: str) -> dict[str, Any]:
    spouse = (await db.execute(select(Relationship).where(Relationship.player_id == pid, Relationship.status == "married"))).scalars().first()
    if not spouse:
        raise SocietyError("not_married")
    n = (await db.execute(select(func.count()).select_from(Child).where(Child.player_id == pid))).scalar_one()
    if n >= MAX_KIDS:
        raise SocietyError("family_full")
    name = " ".join(name.split())[:40]
    if not name:
        raise SocietyError("needs_name")
    await _charge(db, pid, BABY_COST, "baby", f"Welcoming baby {name} (hospital & naming ceremony)")
    c = Child(id=str(uuid.uuid4()), player_id=pid, name=name, gender="girl" if gender == "girl" else "boy", hunger=90, happiness=90, schooling=False, cared_at=_now())
    db.add(c)
    await player_service.add_reputation(db, pid, 5)
    await db.commit()
    return child_out(c)


async def care(db: AsyncSession, pid: str, child_id: str, action: str) -> dict[str, Any]:
    c = await db.get(Child, child_id)
    if not c or c.player_id != pid:
        raise SocietyError("no_such_child")
    _child_tick(c)
    if action == "feed":
        await _charge(db, pid, FEED_COST, "child_food", f"Food for {c.name}")
        c.hunger = min(100, c.hunger + 45)
    elif action == "play":
        c.happiness = min(100, c.happiness + 25)
    elif action == "school":
        if c.schooling:
            raise SocietyError("already_in_school")
        await _charge(db, pid, SCHOOL_FEES, "school_fees_child", f"School fees for {c.name}")
        c.schooling = True
        c.happiness = min(100, c.happiness + 10)
        await player_service.add_reputation(db, pid, 3)
    else:
        raise SocietyError("bad_action")
    c.cared_at = _now()
    await db.commit()
    return child_out(c)


# ================================================================== business
LEVELS = {1: ("Provision shop", 0), 2: ("Supermarket", 30_000_000), 3: ("Shopping mall", 100_000_000)}
RESTAURANT_LEVELS = {1: ("Restaurant", 0), 2: ("Restaurant & lounge", 30_000_000), 3: ("Hotel restaurant", 100_000_000)}
UNIT_COST = 5_000  # 5,000 k-sats wholesale per unit of stock
STAFF_WAGE = 150_000  # 150,000 k-sats per staff per game day
USE_PER_DAY = 10


def _biz_view(st: LifeState) -> dict[str, Any]:
    lv = (RESTAURANT_LEVELS if st.business_kind == "restaurant" else LEVELS)
    return {
        "kind": st.business_kind, "name": st.business_name, "level": st.business_level, "level_name": lv[st.business_level][0],
        "next_level": ({"level": st.business_level + 1, "name": lv[st.business_level + 1][0], "price": lv[st.business_level + 1][1]} if st.business_level < 3 else None),
        "stock": st.business_stock, "max_stock": 120 * st.business_level, "price_pct": st.business_price_pct,
        "staff": st.business_staff, "max_staff": 2 * st.business_level, "sales": st.business_sales,
        "unit_cost": UNIT_COST, "staff_wage": STAFF_WAGE,
    }


def demand(price_pct: int) -> float:
    """Customers come for fair prices: 100% = normal, cheaper sells more units
    for less each, dearer sells fewer."""
    return max(0.2, min(1.6, 1.0 - (price_pct - 100) / 80))


async def business_status(db: AsyncSession, pid: str) -> dict[str, Any]:
    st = await ls.life_state(db, pid)
    await db.commit()
    if not st.business_kind:
        raise SocietyError("no_business")
    return _biz_view(st)


async def business_action(db: AsyncSession, pid: str, action: str, value: int = 0) -> dict[str, Any]:
    st = await ls.life_state(db, pid)
    if not st.business_kind:
        raise SocietyError("no_business")
    if action == "restock":
        n = max(1, min(value or 50, 120 * st.business_level - st.business_stock))
        if n <= 0:
            raise SocietyError("stock_full")
        await _charge(db, pid, n * UNIT_COST, "business_restock", f"Restock {st.business_name} ({n} units)")
        st.business_stock += n
    elif action == "price":
        st.business_price_pct = max(70, min(150, int(value)))
    elif action == "hire":
        if st.business_staff >= 2 * st.business_level:
            raise SocietyError("staff_full")
        st.business_staff += 1
    elif action == "fire":
        st.business_staff = max(0, st.business_staff - 1)
    elif action == "upgrade":
        lv = RESTAURANT_LEVELS if st.business_kind == "restaurant" else LEVELS
        if st.business_level >= 3:
            raise SocietyError("max_level")
        price = lv[st.business_level + 1][1]
        await _charge(db, pid, price, "business_upgrade", f"Upgrade {st.business_name} to {lv[st.business_level + 1][0]}")
        st.business_level += 1
        await player_service.add_reputation(db, pid, 10 * st.business_level)
    else:
        raise SocietyError("bad_action")
    await db.commit()
    return _biz_view(st)


async def collect(db: AsyncSession, pid: str) -> dict[str, Any]:
    """Takings since the last collection: stock-limited, price-sensitive,
    staff sell more but cost wages."""
    st = await ls.life_state(db, pid)
    if not st.business_kind:
        raise SocietyError("no_business")
    last = _aware(st.business_collected_at) or _now()
    days = min(7, int((_now() - last) / GAME_DAY))
    if days < 1:
        raise SocietyError("nothing_to_collect")
    daily = ls.BUSINESSES[st.business_kind][2]
    sell_rate = USE_PER_DAY * st.business_level * demand(st.business_price_pct) * (1 + 0.25 * st.business_staff)
    units = min(st.business_stock, int(sell_rate * days))
    per_unit = daily / USE_PER_DAY * st.business_price_pct / 100
    gross = int(units * per_unit)
    wages = STAFF_WAGE * st.business_staff * days
    net = gross - wages
    st.business_stock -= units
    st.business_collected_at = last + days * GAME_DAY
    if net > 0:
        ls.credit(db, pid, net, "business_income", f"{st.business_name} · {days} day(s): {units} sold")
        st.business_sales += net
    elif net < 0:
        # wages are owed even on a slow week
        await _charge(db, pid, -net, "business_wages", f"{st.business_name} staff wages")
    await db.commit()
    return {"days": days, "units": units, "gross": gross, "wages": wages, "net": net, "business": _biz_view(st)}


# ================================================================== health
ILLNESSES = ["malaria", "typhoid", "flu", "stomach upset"]
HOSPITAL_COST = 500_000


def _health_tick(st: LifeState) -> str | None:
    """Lazy health clock, in whole game days (the remainder carries over):
    sick = -5 a day until treated; well = slowly back toward a level set
    by fitness. Illness is likelier when run down. Time away counts for at
    most 3 game days, so a weekend offline doesn't wreck you."""
    if st.health_checked_at is None:
        st.health_checked_at = _now()
        return None
    last = _aware(st.health_checked_at)
    whole = int(_days_since(last))
    if whole < 1:
        return None
    counted = min(whole, 3)
    news = None
    for _ in range(counted):
        if st.sick:
            st.health = max(5, st.health - 5)
        else:
            target = min(100, 70 + st.fitness // 4)
            if st.health < target:
                st.health = min(target, st.health + 2)
            if random.random() < max(0.0, (75 - st.health - st.fitness / 5) / 250):
                st.sick = random.choice(ILLNESSES)
                news = st.sick
    st.health_checked_at = last + whole * GAME_DAY
    return news


def health_out(st: LifeState) -> dict[str, Any]:
    return {"health": st.health, "fitness": st.fitness, "stamina": 50 + st.fitness // 2, "sick": st.sick, "hospital_cost": HOSPITAL_COST,
            "work_factor": 0.5 if st.sick else 1.0}


async def health(db: AsyncSession, pid: str) -> dict[str, Any]:
    st = await ls.life_state(db, pid)
    news = _health_tick(st)
    await db.commit()
    return {**health_out(st), "news": news}


async def hospital(db: AsyncSession, pid: str) -> dict[str, Any]:
    st = await ls.life_state(db, pid)
    _health_tick(st)
    await _charge(db, pid, HOSPITAL_COST, "hospital", f"Hospital visit{f' ({st.sick})' if st.sick else ' (check-up)'}")
    cured = st.sick
    st.sick = None
    st.health = min(100, st.health + 35)
    await db.commit()
    return {**health_out(st), "cured": cured}


async def workout(db: AsyncSession, pid: str) -> dict[str, Any]:
    """Called when you pay for a gym session (venues) or finish a hike."""
    st = await ls.life_state(db, pid)
    _health_tick(st)
    st.fitness = min(100, st.fitness + 3)
    st.health = min(100, st.health + 3)
    await db.commit()
    return health_out(st)


# ================================================================== politics
CANDIDACY_FEE = 2_000_000
ELECTION_AFTER = timedelta(minutes=30)
MIN_REP = 40
ACTIONS = {"rally": (500_000, 6, 180), "posters": (300_000, 4, 120), "door_to_door": (0, 2, 60), "radio": (800_000, 8, 240)}
PROJECTS = {"borehole": (5_000_000, 20, "Borehole for the ward"), "streetlights": (4_000_000, 15, "Solar streetlights"), "road": (8_000_000, 30, "Road patching"), "clinic": (10_000_000, 35, "Clinic renovation")}
ALLOWANCE = 3_000_000
RIVALS = ["Alhaji Danladi (Unity Forum)", "Mrs Comfort Yakubu (Progress Alliance)", "Mallam Sani (Peoples' Voice)"]


def politics_out(st: LifeState, rep: int) -> dict[str, Any]:
    started = _aware(st.campaign_started_at)
    ends = started + ELECTION_AFTER if started else None
    return {
        "office": st.office, "reputation": rep, "min_reputation": MIN_REP, "fee": CANDIDACY_FEE,
        "campaign": {"support": st.campaign_support, "rival": st.campaign_rival, "rival_name": RIVALS[st.campaign_rival % len(RIVALS)],
                     "election_at": ends.isoformat() if ends else None, "seconds_left": max(0, int((ends - _now()).total_seconds())) if ends else None} if started else None,
        "actions": {k: {"cost": v[0], "support": v[1], "cooldown_s": v[2]} for k, v in ACTIONS.items()},
        "projects": {k: {"cost": v[0], "rep": v[1], "name": v[2]} for k, v in PROJECTS.items()},
        "allowance": ALLOWANCE,
    }


async def politics(db: AsyncSession, pid: str) -> dict[str, Any]:
    st = await ls.life_state(db, pid)
    prof = await db.get(PlayerProfile, pid)
    result = await _maybe_election(db, st, pid)
    await db.commit()
    return {**politics_out(st, prof.reputation if prof else 0), "result": result}


async def _maybe_election(db: AsyncSession, st: LifeState, pid: str) -> dict[str, Any] | None:
    started = _aware(st.campaign_started_at)
    if not started or _now() < started + ELECTION_AFTER:
        return None
    # rival's machine grows with time too
    rival_votes = st.campaign_rival + random.randint(-8, 8)
    won = st.campaign_support > rival_votes
    st.campaign_started_at = None
    out = {"won": won, "you": st.campaign_support, "rival": max(0, rival_votes)}
    if won:
        st.office = "councillor"
        await player_service.add_reputation(db, pid, 50)
    st.campaign_support = 0
    return out


async def declare(db: AsyncSession, pid: str) -> dict[str, Any]:
    st = await ls.life_state(db, pid)
    prof = await db.get(PlayerProfile, pid)
    if st.office:
        raise SocietyError("already_in_office")
    if st.campaign_started_at:
        raise SocietyError("already_campaigning")
    if not prof or prof.reputation < MIN_REP:
        raise SocietyError("not_enough_reputation")
    await _charge(db, pid, CANDIDACY_FEE, "candidacy_fee", "Ward councillor nomination fee")
    st.campaign_started_at = _now()
    st.campaign_support = 5 + prof.reputation // 10
    st.campaign_rival = random.randint(35, 60)
    await db.commit()
    return politics_out(st, prof.reputation)


_cool: dict[tuple[str, str], datetime] = {}


async def campaign(db: AsyncSession, pid: str, action: str) -> dict[str, Any]:
    st = await ls.life_state(db, pid)
    if not st.campaign_started_at:
        raise SocietyError("not_campaigning")
    if action not in ACTIONS:
        raise SocietyError("bad_action")
    cost, gain, cool = ACTIONS[action]
    last = _cool.get((pid, action))
    if last and (_now() - last).total_seconds() < cool:
        raise SocietyError("too_soon")
    await _charge(db, pid, cost, "campaign", f"Campaign: {action.replace('_', ' ')}")
    prof = await db.get(PlayerProfile, pid)
    st.campaign_support += gain + (prof.reputation // 40 if prof else 0)
    _cool[(pid, action)] = _now()
    await db.commit()
    return politics_out(st, prof.reputation if prof else 0)


async def project(db: AsyncSession, pid: str, kind: str) -> dict[str, Any]:
    st = await ls.life_state(db, pid)
    if st.office != "councillor":
        raise SocietyError("not_in_office")
    if kind not in PROJECTS:
        raise SocietyError("bad_action")
    cost, rep, name = PROJECTS[kind]
    await _charge(db, pid, cost, "ward_project", name)
    await player_service.add_reputation(db, pid, rep)
    await db.commit()
    prof = await db.get(PlayerProfile, pid)
    return politics_out(st, prof.reputation if prof else 0)


async def allowance(db: AsyncSession, pid: str) -> dict[str, Any]:
    st = await ls.life_state(db, pid)
    if st.office != "councillor":
        raise SocietyError("not_in_office")
    last = (await db.execute(select(func.max(ls.GameLedgerEntry.created_at)).where(
        ls.GameLedgerEntry.account_reference == f"player:{pid}", ls.GameLedgerEntry.entry_type == "councillor_allowance"))).scalar_one()
    if last is not None and _now() - _aware(last) < timedelta(hours=1):
        raise SocietyError("too_soon")
    ls.credit(db, pid, ALLOWANCE, "councillor_allowance", "Councillor's allowance")
    await db.commit()
    return {"paid": ALLOWANCE}


# ================================================================== town activities
ACTIVITIES: dict[str, dict[str, Any]] = {
    "polo": {"town": "zaria", "name": "Zaria Polo Match", "cost": 200_000, "fitness": 0, "rep": 2, "cooldown": 300},
    "train_ride": {"town": "kafanchan", "name": "Kafanchan Train Ride", "cost": 300_000, "fitness": 0, "rep": 1, "cooldown": 300},
    "kagoro_hike": {"town": "kafanchan", "name": "Kagoro Hills Hike", "cost": 0, "fitness": 6, "rep": 1, "cooldown": 600},
    "market_day": {"town": "kachia", "name": "Kachia Market Day", "cost": 100_000, "fitness": 0, "rep": 1, "cooldown": 300},
}


async def activity(db: AsyncSession, pid: str, aid: str, result: dict[str, Any] | None = None) -> dict[str, Any]:
    from app.services.travel_service import SLUG_TO_ID, region_of

    a = ACTIVITIES.get(aid)
    if not a:
        raise SocietyError("bad_action")
    if SLUG_TO_ID.get(await region_of(db, pid), "kaduna") != a["town"]:
        raise SocietyError("wrong_town")
    last = _cool.get((pid, "act:" + aid))
    if last and (_now() - last).total_seconds() < a["cooldown"]:
        raise SocietyError("too_soon")
    await _charge(db, pid, a["cost"], "activity", a["name"])
    out: dict[str, Any] = {"activity": aid, "name": a["name"]}
    if a["rep"]:
        await player_service.add_reputation(db, pid, a["rep"])
    if a["fitness"]:
        st = await ls.life_state(db, pid)
        st.fitness = min(100, st.fitness + a["fitness"])
        st.health = min(100, st.health + 4)
    if aid == "polo" and result and result.get("bet") in ("Zazzau Riders", "Kano Chargers"):
        # a small friendly wager on the result (100,000 → 180,000 ks if right)
        winner = random.choice(["Zazzau Riders", "Zazzau Riders", "Kano Chargers"])
        out["winner"] = winner
        await _charge(db, pid, 100_000, "polo_bet", "Polo wager")
        if winner == result["bet"]:
            ls.credit(db, pid, 180_000, "polo_win", f"Polo wager: {winner} won")
            out["won"] = 180_000
    if aid == "market_day":
        # market day bargain: groceries at half price fill you up (client need)
        out["bargain"] = "Fresh yams, tomatoes and grains at market-day prices"
    _cool[(pid, "act:" + aid)] = _now()
    await db.commit()
    return out


# ================================================================== crews
CREW_FEE = 1_000_000


async def _my_crew(db: AsyncSession, pid: str) -> tuple[Crew, CrewMember] | None:
    m = (await db.execute(select(CrewMember).where(CrewMember.player_id == pid))).scalar_one_or_none()
    if not m:
        return None
    c = await db.get(Crew, m.crew_id)
    return (c, m) if c else None


async def crew_out(db: AsyncSession, c: Crew) -> dict[str, Any]:
    members = (await db.execute(select(CrewMember, PlayerProfile).join(PlayerProfile, PlayerProfile.id == CrewMember.player_id).where(CrewMember.crew_id == c.id))).all()
    return {"id": c.id, "name": c.name, "tag": c.tag, "color": c.color, "owner_id": c.owner_id,
            "members": [{"id": p.id, "name": p.display_name, "role": m.role} for m, p in members]}


async def turf(db: AsyncSession) -> dict[str, dict[str, Any]]:
    """A route belongs to the crew whose member holds its best time."""
    rows = (await db.execute(select(RaceTime.route, RaceTime.player_id, func.min(RaceTime.ms)).group_by(RaceTime.route, RaceTime.player_id))).all()
    best: dict[str, tuple[int, str]] = {}
    for route, p, ms in rows:
        if route not in best or ms < best[route][0]:
            best[route] = (ms, p)
    out: dict[str, dict[str, Any]] = {}
    for route, (ms, p) in best.items():
        m = (await db.execute(select(CrewMember).where(CrewMember.player_id == p))).scalar_one_or_none()
        if m:
            c = await db.get(Crew, m.crew_id)
            if c:
                out[route] = {"crew": c.name, "tag": c.tag, "color": c.color, "ms": ms}
    return out


async def crews(db: AsyncSession, pid: str) -> dict[str, Any]:
    mine = await _my_crew(db, pid)
    all_c = (await db.execute(select(Crew).order_by(Crew.created_at.desc()).limit(30))).scalars().all()
    msgs: list[dict[str, Any]] = []
    if mine:
        rows = (await db.execute(select(CrewMessage).where(CrewMessage.crew_id == mine[0].id).order_by(CrewMessage.created_at.desc()).limit(50))).scalars().all()
        msgs = [{"from": m.from_id, "name": m.name, "text": m.text, "at": m.created_at.isoformat() if m.created_at else None} for m in reversed(rows)]
    return {"mine": await crew_out(db, mine[0]) if mine else None, "messages": msgs,
            "crews": [await crew_out(db, c) for c in all_c], "turf": await turf(db), "fee": CREW_FEE}


async def create_crew(db: AsyncSession, pid: str, name: str, tag: str, color: str) -> dict[str, Any]:
    if await _my_crew(db, pid):
        raise SocietyError("already_in_crew")
    name = " ".join(name.split())[:40]
    tag = "".join(ch for ch in tag.upper() if ch.isalnum())[:5]
    if len(name) < 3 or len(tag) < 2:
        raise SocietyError("bad_name")
    if (await db.execute(select(Crew).where(func.lower(Crew.name) == name.lower()))).scalar_one_or_none():
        raise SocietyError("name_taken")
    await _charge(db, pid, CREW_FEE, "crew_create", f"Founded the crew {name}")
    c = Crew(id=str(uuid.uuid4()), name=name, tag=tag, color=color if color.startswith("#") and len(color) <= 9 else "#e0a020", owner_id=pid)
    db.add(c)
    db.add(CrewMember(id=str(uuid.uuid4()), crew_id=c.id, player_id=pid, role="leader"))
    await db.commit()
    return await crew_out(db, c)


async def join_crew(db: AsyncSession, pid: str, crew_id: str) -> dict[str, Any]:
    if await _my_crew(db, pid):
        raise SocietyError("already_in_crew")
    c = await db.get(Crew, crew_id)
    if not c:
        raise SocietyError("no_such_crew")
    n = (await db.execute(select(func.count()).select_from(CrewMember).where(CrewMember.crew_id == c.id))).scalar_one()
    if n >= 20:
        raise SocietyError("crew_full")
    db.add(CrewMember(id=str(uuid.uuid4()), crew_id=c.id, player_id=pid, role="member"))
    await db.commit()
    return await crew_out(db, c)


async def leave_crew(db: AsyncSession, pid: str) -> None:
    mine = await _my_crew(db, pid)
    if not mine:
        raise SocietyError("not_in_crew")
    c, m = mine
    await db.delete(m)
    await db.flush()
    rest = (await db.execute(select(CrewMember).where(CrewMember.crew_id == c.id).order_by(CrewMember.created_at))).scalars().all()
    if not rest:
        # last one out: the crew and its chat go with it
        for msg in (await db.execute(select(CrewMessage).where(CrewMessage.crew_id == c.id))).scalars().all():
            await db.delete(msg)
        await db.delete(c)
    elif c.owner_id == pid:
        c.owner_id = rest[0].player_id
        rest[0].role = "leader"
    await db.commit()


async def crew_say(db: AsyncSession, pid: str, name: str, text: str) -> tuple[list[str], dict[str, Any]]:
    mine = await _my_crew(db, pid)
    if not mine:
        raise SocietyError("not_in_crew")
    text = text.strip()[:400]
    if not text:
        raise SocietyError("empty")
    db.add(CrewMessage(id=str(uuid.uuid4()), crew_id=mine[0].id, from_id=pid, name=name, text=text))
    await db.commit()
    members = (await db.execute(select(CrewMember.player_id).where(CrewMember.crew_id == mine[0].id))).scalars().all()
    return list(members), {"crew": mine[0].id, "from": pid, "name": name, "text": text}


# ================================================================== gifting
GIFT_MAX = 5_000_000  # 5,000,000 k-sats per gift


async def gift(db: AsyncSession, pid: str, to: str, amount: int = 0, item_code: str | None = None) -> dict[str, Any]:
    if to == pid or not await db.get(PlayerProfile, to):
        raise SocietyError("no_such_person")
    me = await db.get(PlayerProfile, pid)
    out: dict[str, Any] = {}
    if amount:
        if amount < 0 or amount > GIFT_MAX:
            raise SocietyError("bad_amount")
        await _charge(db, pid, amount, "gift_sent", "Gift sent")
        ls.credit(db, to, amount, "gift_received", f"Gift from {me.display_name if me else 'a friend'}")
        out["amount"] = amount
    if item_code:
        item = (await db.execute(select(Item).where(Item.code == item_code))).scalar_one_or_none()
        mine = item and (await db.execute(select(Inventory).where(Inventory.player_id == pid, Inventory.item_id == item.id))).scalar_one_or_none()
        if not item or not mine or mine.quantity < 1:
            raise SocietyError("no_such_item")
        mine.quantity -= 1
        theirs = (await db.execute(select(Inventory).where(Inventory.player_id == to, Inventory.item_id == item.id))).scalar_one_or_none()
        if theirs:
            theirs.quantity += 1
        else:
            db.add(Inventory(player_id=to, item_id=item.id, quantity=1))
        out["item"] = item.name
    if not out:
        raise SocietyError("empty")
    # gifts warm the relationship both ways
    from app.services.social_service import get_rel

    for a, b in ((pid, to), (to, pid)):
        r = await get_rel(db, a, "player", b)
        r.friendship = min(100, r.friendship + 5)
    await db.commit()
    return out
