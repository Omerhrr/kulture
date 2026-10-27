"""A life that progresses: school -> certificate -> career, money -> rent ->
own house -> car -> your own business, and the dream's milestones.

Everything that costs or pays money goes through the ledger here, so
balances stay the single source of truth."""

from __future__ import annotations

import asyncio
import hashlib

import random
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ledger import GameLedgerEntry
from app.models.life import Enrollment, LifeState, Relationship
from app.models.work import WorkShift
from app.services import player_service


class LifeError(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# --------------------------------------------------------------- ledger
async def balance(db: AsyncSession, player_id: str, asset: str = "ksats") -> int:
    if asset == "ksats":
        return await player_service.ksats_balance(db, player_id)
    total = await db.execute(
        select(func.coalesce(func.sum(GameLedgerEntry.amount_minor_units), 0)).where(
            GameLedgerEntry.account_reference == f"player:{player_id}", GameLedgerEntry.asset_type == asset
        )
    )
    return int(total.scalar_one())


# One lock per (player, asset): a debit's balance probe can never see another
# session's uncommitted debit, so two tabs double-tapping a purchase could both
# pass the pre-check and draw the balance negative. Serializing charge() per
# account fixes that within a server process (how the game runs).
_charge_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


async def charge(db: AsyncSession, player_id: str, amount: int, kind: str, description: str, asset: str = "ksats",
                 ref: str | None = None, meta: dict | None = None) -> None:
    if amount <= 0:
        return
    async with _charge_locks[f"{player_id}:{asset}"]:
        if await balance(db, player_id, asset) < amount:
            raise LifeError("insufficient_funds")
        entry = GameLedgerEntry(account_reference=f"player:{player_id}", asset_type=asset, amount_minor_units=-amount,
                                transaction_reference=ref or f"{kind}:{uuid.uuid4().hex[:12]}", entry_type=kind, description=description,
                                metadata_json=meta or {})
        db.add(entry)
        # re-check after the debit is written: two purchases racing each other
        # (double tap, two tabs) must not both pass the check above
        await db.flush()
        if await balance(db, player_id, asset) < 0:
            await db.delete(entry)
            await db.flush()
            raise LifeError("insufficient_funds")


def credit(db: AsyncSession, player_id: str, amount: int, kind: str, description: str, asset: str = "ksats",
           ref: str | None = None, meta: dict | None = None) -> None:
    if amount <= 0:
        return
    db.add(GameLedgerEntry(account_reference=f"player:{player_id}", asset_type=asset, amount_minor_units=amount,
                           transaction_reference=ref or f"{kind}:{uuid.uuid4().hex[:12]}", entry_type=kind, description=description,
                           metadata_json=meta or {}))


# --------------------------------------------------------------- school
SCHOOLS = {
    "kadpoly": {"name": "Kaduna Polytechnic", "fee": 2_000_000, "lectures": 4},
    "kasu": {"name": "Kaduna State University", "fee": 3_500_000, "lectures": 5},
}
COURSES = {
    "computer_science": {"name": "Computer Science", "career": "developer"},
    "banking_finance": {"name": "Banking & Finance", "career": "banker"},
    "medicine": {"name": "Medicine & Surgery", "career": "doctor"},
    "business_admin": {"name": "Business Administration", "career": "manager"},
}
# id -> (course, question, options, answer index)
QUESTIONS: dict[str, tuple[str, str, list[str], int]] = {}


def _q(course: str, items: list[tuple[str, list[str], int]]) -> None:
    for i, (q, opts, a) in enumerate(items):
        QUESTIONS[f"{course}:{i}"] = (course, q, opts, a)


_q("computer_science", [
    ("What does CPU stand for?", ["Central Processing Unit", "Computer Power Unit", "Core Program Utility", "Central Print Unit"], 0),
    ("Which of these is a programming language?", ["HTML", "Python", "HTTP", "JPEG"], 1),
    ("1 byte is how many bits?", ["4", "8", "16", "2"], 1),
    ("What does a database index mainly speed up?", ["Backups", "Lookups", "Screen brightness", "Printing"], 1),
    ("Which number system do computers use internally?", ["Decimal", "Roman", "Binary", "Hexadecimal only"], 2),
    ("What is a 'bug' in software?", ["A virus", "An error in a program", "A keyboard", "A fast loop"], 1),
    ("Which protocol secures websites (the padlock)?", ["FTP", "HTTPS", "SMTP", "DHCP"], 1),
    ("What does RAM do?", ["Stores data permanently", "Holds data a program is using now", "Cools the CPU", "Prints pages"], 1),
    ("Bitcoin's Lightning Network is mainly for…", ["Mining", "Fast, cheap payments", "Storing photos", "Charging phones"], 1),
    ("A loop that never ends is called…", ["Infinite loop", "Closed loop", "Short circuit", "Recursion only"], 0),
    ("Which is an operating system?", ["Linux", "Excel", "Chrome", "Paint"], 0),
    ("Git is used for…", ["Version control", "Video editing", "Email", "Gaming"], 0),
])
_q("banking_finance", [
    ("Nigeria's central bank is the…", ["CBN", "NDIC", "SEC", "FIRS"], 0),
    ("Interest is the…", ["Cost of borrowing money", "Bank's address", "Exchange rate", "Tax on food"], 0),
    ("Inflation means prices generally…", ["Fall", "Rise", "Stay fixed", "Disappear"], 1),
    ("Which body insures bank deposits in Nigeria?", ["NDIC", "NAFDAC", "INEC", "NNPC"], 0),
    ("A 'debit' to your account…", ["Adds money", "Takes money out", "Closes it", "Freezes it"], 1),
    ("BVN stands for…", ["Bank Verification Number", "Basic Value Note", "Bank Voucher Number", "Branch Vault Number"], 0),
    ("Diversifying investments mainly reduces…", ["Risk", "Taxes", "Profit always", "Paperwork"], 0),
    ("The naira's symbol is…", ["$", "₦", "€", "£"], 1),
    ("A loan's 'principal' is…", ["The amount borrowed", "The bank manager", "The interest only", "The penalty"], 0),
    ("Which is a liquid asset?", ["Cash", "Land", "A building", "A factory"], 0),
    ("Compound interest earns interest on…", ["Only the principal", "Principal plus past interest", "Nothing", "Taxes"], 1),
    ("The stock exchange in Lagos is the…", ["NGX", "NYSE", "LSE", "JSE"], 0),
])
_q("medicine", [
    ("The heart has how many chambers?", ["2", "3", "4", "6"], 2),
    ("Malaria is spread by…", ["Houseflies", "Anopheles mosquitoes", "Dirty water", "Dogs"], 1),
    ("Normal body temperature is about…", ["30°C", "37°C", "42°C", "25°C"], 1),
    ("ORS is used to treat…", ["Dehydration", "Broken bones", "Headache only", "Malaria"], 0),
    ("Which organ filters blood to make urine?", ["Liver", "Kidney", "Lungs", "Stomach"], 1),
    ("Red blood cells carry…", ["Oxygen", "Sugar only", "Hormones only", "Bile"], 0),
    ("A vaccine works by…", ["Killing all germs", "Training the immune system", "Lowering fever", "Replacing blood"], 1),
    ("The largest organ of the body is the…", ["Liver", "Brain", "Skin", "Heart"], 2),
    ("Insulin controls…", ["Blood sugar", "Height", "Eye colour", "Hearing"], 0),
    ("Hand washing mainly prevents…", ["Infections", "Sunburn", "Hunger", "Fatigue"], 0),
    ("Which vitamin do we get from sunlight?", ["Vitamin C", "Vitamin D", "Vitamin K", "Vitamin B12"], 1),
    ("BP stands for…", ["Blood pressure", "Body power", "Bone pain", "Breath pulse"], 0),
])
_q("business_admin", [
    ("Profit is…", ["Revenue minus costs", "Costs minus revenue", "Total sales", "Salaries"], 0),
    ("A business plan is mainly for…", ["Planning and raising money", "Decoration", "Tax evasion", "Hiring only"], 0),
    ("CAC registers businesses in Nigeria. CAC means…", ["Corporate Affairs Commission", "Central Audit Council", "Company Account Centre", "Customs Agency"], 0),
    ("Marketing is about…", ["Understanding and reaching customers", "Only accounting", "Building roads", "Printing money"], 0),
    ("A SWOT analysis covers strengths, weaknesses, opportunities and…", ["Taxes", "Threats", "Trends", "Targets"], 1),
    ("Cash flow measures…", ["Money moving in and out", "Stock prices", "Staff numbers", "Office size"], 0),
    ("Fixed costs…", ["Change with sales", "Stay the same whatever you sell", "Are always zero", "Are profits"], 1),
    ("Customer retention means…", ["Keeping customers coming back", "Arresting customers", "Raising prices", "Closing early"], 0),
    ("An entrepreneur is someone who…", ["Starts and runs a business", "Only works shifts", "Audits banks", "Teaches"], 0),
    ("Break-even is when…", ["Revenue equals costs", "Profit is highest", "You close", "You hire"], 0),
    ("Kantin Kwari market is famous for…", ["Textiles", "Cars", "Phones only", "Fish"], 0),
    ("Delegation means…", ["Giving tasks to others", "Firing staff", "Lowering prices", "Taking loans"], 0),
])


async def enrollment(db: AsyncSession, player_id: str) -> Enrollment | None:
    return (await db.execute(select(Enrollment).where(Enrollment.player_id == player_id).order_by(Enrollment.created_at.desc()))).scalars().first()


async def certificates(db: AsyncSession, player_id: str) -> list[str]:
    rows = (await db.execute(select(Enrollment).where(Enrollment.player_id == player_id, Enrollment.certified.is_(True)))).scalars().all()
    return [r.course for r in rows]


async def enroll(db: AsyncSession, player_id: str, school: str, course: str) -> Enrollment:
    if school not in SCHOOLS or course not in COURSES:
        raise LifeError("unknown_course")
    cur = await enrollment(db, player_id)
    if cur and not cur.certified:
        raise LifeError("already_enrolled")
    if course in await certificates(db, player_id):
        raise LifeError("already_certified")
    await charge(db, player_id, SCHOOLS[school]["fee"], "school_fees", f"{SCHOOLS[school]['name']} fees · {COURSES[course]['name']}")
    e = Enrollment(player_id=player_id, school=school, course=course, pending={})
    db.add(e)
    await db.commit()
    await db.refresh(e)
    return e


def _public_q(qid: str) -> dict[str, Any]:
    _, q, opts, _a = QUESTIONS[qid]
    return {"id": qid, "q": q, "options": opts}


async def start_session(db: AsyncSession, player_id: str, kind: str) -> dict[str, Any]:
    """kind: lecture (3 questions) | exam (8 questions, after all lectures)."""
    e = await enrollment(db, player_id)
    if not e or e.certified:
        raise LifeError("not_enrolled")
    need = SCHOOLS[e.school]["lectures"]
    if kind == "exam" and e.lectures_done < need:
        raise LifeError("lectures_first")
    if kind == "lecture" and e.lectures_done >= need:
        raise LifeError("ready_for_exam")
    pool = [k for k, v in QUESTIONS.items() if v[0] == e.course]
    qs = random.sample(pool, 3 if kind == "lecture" else 8)
    e.pending = {"kind": kind, "ids": qs}
    await db.commit()
    return {"kind": kind, "questions": [_public_q(q) for q in qs], "course": COURSES[e.course]["name"]}


async def submit_session(db: AsyncSession, player_id: str, answers: dict[str, int]) -> dict[str, Any]:
    e = await enrollment(db, player_id)
    if not e or not e.pending.get("ids"):
        raise LifeError("no_session")
    ids = list(e.pending["ids"])
    kind = e.pending.get("kind")
    correct = sum(1 for q in ids if answers.get(q) == QUESTIONS[q][3])
    review = [{"id": q, "answer": QUESTIONS[q][3], "yours": answers.get(q)} for q in ids]
    out: dict[str, Any] = {"kind": kind, "correct": correct, "total": len(ids), "review": review}
    if kind == "lecture":
        passed = correct >= 2
        if passed:
            e.lectures_done += 1
        out["passed"] = passed
    else:
        score = round(100 * correct / len(ids))
        e.exam_score = score
        passed = score >= 60
        out["passed"] = passed
        out["score"] = score
        if passed:
            e.certified = True
            await player_service.add_reputation(db, player_id, 10)
    e.pending = {}
    await db.commit()
    out["enrollment"] = enrollment_out(e)
    return out


def enrollment_out(e: Enrollment | None) -> dict[str, Any] | None:
    if not e:
        return None
    return {
        "school": e.school,
        "school_name": SCHOOLS[e.school]["name"],
        "course": e.course,
        "course_name": COURSES[e.course]["name"],
        "lectures_done": e.lectures_done,
        "lectures_needed": SCHOOLS[e.school]["lectures"],
        "exam_score": e.exam_score,
        "certified": e.certified,
    }


# --------------------------------------------------------------- property
RENT = 1_500_000  # per game week (real hour)
RENT_PERIOD = timedelta(hours=1)
HOUSE_PRICE = 40_000_000
CARS = {1: ("Used Toyota Corolla", 15_000_000), 2: ("Toyota Hilux", 45_000_000), 3: ("Mercedes G-Wagon", 120_000_000)}
BUSINESSES = {"shop": ("Provision shop", 20_000_000, 400_000), "restaurant": ("Restaurant", 45_000_000, 900_000)}
BUSINESS_PERIOD = timedelta(minutes=8)  # one game day


async def life_state(db: AsyncSession, player_id: str) -> LifeState:
    st = await db.get(LifeState, player_id)
    if st is None:
        st = LifeState(player_id=player_id, housing="family", car_tier=0, business_sales=0)
        db.add(st)
        await db.flush()
    return st


async def rent(db: AsyncSession, player_id: str) -> LifeState:
    st = await life_state(db, player_id)
    if st.housing == "own":
        raise LifeError("already_own")
    paid = _aware(st.rent_paid_at)
    if st.housing == "rent" and paid and _now() - paid < RENT_PERIOD:
        raise LifeError("rent_not_due")
    await charge(db, player_id, RENT, "rent", "Weekly rent · your own flat")
    st.housing = "rent"
    st.rent_paid_at = _now()
    await db.commit()
    return st


async def buy_house(db: AsyncSession, player_id: str) -> LifeState:
    st = await life_state(db, player_id)
    if st.housing == "own":
        raise LifeError("already_own")
    await charge(db, player_id, HOUSE_PRICE, "house_purchase", "Bought your own house")
    st.housing = "own"
    await player_service.add_reputation(db, player_id, 25)
    await db.commit()
    return st


CAR_COLORS = ["#3f6fae", "#b9bcc2", "#f2f2ee", "#121212", "#b8433a", "#2f7d5b", "#e0a020", "#6a4a8a"]


def _plate(player_id: str) -> str:
    """Kaduna-style number plate, stable per owner: KD 123 ABC."""
    h = int(hashlib.sha1(player_id.encode()).hexdigest(), 16)
    letters = "ABCDEFGHJKLMNPRSTUVWXYZ"
    return f"KD{100 + h % 900} {letters[h // 900 % 23]}{letters[h // 20700 % 23]}{letters[h // 476100 % 23]}"


async def buy_car(db: AsyncSession, player_id: str, tier: int, color: str | None = None) -> LifeState:
    st = await life_state(db, player_id)
    if tier not in CARS or tier <= st.car_tier:
        raise LifeError("bad_car")
    name, price = CARS[tier]
    trade_in = CARS[st.car_tier][1] // 2 if st.car_tier in CARS else 0
    await charge(db, player_id, max(0, price - trade_in), "car_purchase", f"Bought a {name}" + (" (trade-in)" if trade_in else ""))
    st.car_tier = tier
    st.car_color = color if color in CAR_COLORS else (st.car_color or CAR_COLORS[(tier * 3) % len(CAR_COLORS)])
    st.car_plate = st.car_plate or _plate(player_id)
    # a new car is delivered to your home car park
    st.car_x = None
    st.car_z = None
    await player_service.add_reputation(db, player_id, 5 * tier)
    await db.commit()
    return st


async def paint_car(db: AsyncSession, player_id: str, color: str) -> LifeState:
    st = await life_state(db, player_id)
    if not st.car_tier:
        raise LifeError("no_car")
    if color not in CAR_COLORS:
        raise LifeError("bad_color")
    await charge(db, player_id, 1_500_000, "car_paint", "Car respray")
    st.car_color = color
    await db.commit()
    return st


async def park_car(db: AsyncSession, player_id: str, region: str, x: float, z: float, heading: float) -> None:
    st = await life_state(db, player_id)
    if not st.car_tier:
        raise LifeError("no_car")
    st.car_region = region
    st.car_x = float(x)
    st.car_z = float(z)
    st.car_heading = float(heading)
    await db.commit()


async def parked_cars(db: AsyncSession, region: str) -> list[dict[str, Any]]:
    """Everyone's own cars parked in this town (shown to other players)."""
    from app.models.player import PlayerProfile

    rows = (await db.execute(select(LifeState, PlayerProfile).join(PlayerProfile, PlayerProfile.id == LifeState.player_id).where(LifeState.car_tier > 0))).all()
    out = []
    for st, prof in rows:
        out.append({"owner_id": prof.id, "owner": prof.display_name, "tier": st.car_tier, "name": CARS[st.car_tier][0], "color": st.car_color or CAR_COLORS[0],
                    "plate": st.car_plate or _plate(prof.id), "parked": st.car_x is not None and (st.car_region or "kaduna-city") == region,
                    "x": st.car_x, "z": st.car_z, "heading": st.car_heading})
    return out


async def open_business(db: AsyncSession, player_id: str, kind: str, name: str) -> LifeState:
    st = await life_state(db, player_id)
    if kind not in BUSINESSES:
        raise LifeError("bad_business")
    if st.business_kind:
        raise LifeError("already_have_business")
    if "business_admin" not in await certificates(db, player_id) and st.housing == "family":
        # you need either a business certificate or to have moved out first
        raise LifeError("not_ready_for_business")
    label, price, _ = BUSINESSES[kind]
    clean = " ".join(name.split())[:40] or f"My {label}"
    await charge(db, player_id, price, "business_open", f"Opened {clean}")
    st.business_kind = kind
    st.business_name = clean
    st.business_collected_at = _now()
    await player_service.add_reputation(db, player_id, 20)
    await db.commit()
    return st


async def businesses(db: AsyncSession) -> list[dict[str, Any]]:
    rows = (await db.execute(select(LifeState).where(LifeState.business_kind.is_not(None)))).scalars().all()
    out = []
    for r in rows:
        prof = await player_service_profile(db, r.player_id)
        out.append({"owner_id": r.player_id, "owner": prof, "kind": r.business_kind, "name": r.business_name})
    return out


async def player_service_profile(db: AsyncSession, player_id: str) -> str:
    from app.models.player import PlayerProfile

    p = await db.get(PlayerProfile, player_id)
    return p.display_name if p else "Someone"


async def sell_at_business(db: AsyncSession, buyer_id: str, owner_id: str, amount: int) -> None:
    """A purchase at another player's business pays the owner 70%."""
    if buyer_id == owner_id:
        return
    st = await db.get(LifeState, owner_id)
    if not st or not st.business_kind or st.business_stock <= 0:
        return
    st.business_stock -= 1
    share = int(amount * 0.7 * st.business_price_pct / 100)
    credit(db, owner_id, share, "business_sale", f"Customer at {st.business_name}")
    st.business_sales += share


# --------------------------------------------------------------- careers
# certificate careers (on top of the walk-in jobs in shift_service)
PRO_CAREERS = {
    "developer": {"title": "Software Developer", "pay": 4_500_000, "needs": "computer_science"},
    "banker": {"title": "Bank Officer", "pay": 4_000_000, "needs": "banking_finance"},
    "doctor": {"title": "Medical Doctor", "pay": 6_000_000, "needs": "medicine"},
    "manager": {"title": "Business Manager", "pay": 4_200_000, "needs": "business_admin"},
}


async def shifts_worked(db: AsyncSession, player_id: str) -> int:
    n = await db.execute(select(func.count()).select_from(WorkShift).where(WorkShift.player_id == player_id, WorkShift.paid_ksats > 0))
    return int(n.scalar_one())


LEVELS = [(0, "Junior"), (3, "Associate"), (8, "Senior"), (15, "Lead"), (25, "Oga")]


def career_level(shifts: int) -> tuple[int, str]:
    lvl = 0
    for i, (need, _) in enumerate(LEVELS):
        if shifts >= need:
            lvl = i
    return lvl, LEVELS[lvl][1]


# --------------------------------------------------------------- dream
async def dream_progress(db: AsyncSession, player_id: str, dream: str) -> dict[str, Any]:
    st = await life_state(db, player_id)
    certs = await certificates(db, player_id)
    shifts = await shifts_worked(db, player_id)
    worth = await balance(db, player_id) + (HOUSE_PRICE if st.housing == "own" else 0) + (CARS[st.car_tier][1] // 2 if st.car_tier in CARS else 0)
    friends = (await db.execute(select(func.count()).select_from(Relationship).where(Relationship.player_id == player_id, Relationship.friendship >= 80))).scalar_one()
    sats_pays = (await db.execute(select(func.count()).select_from(GameLedgerEntry).where(GameLedgerEntry.account_reference == f"player:{player_id}", GameLedgerEntry.entry_type.in_(("purchase", "payment", "lightning_payment"))))).scalar_one()
    lvl, _ = career_level(shifts)

    def m(label: str, done: bool) -> dict[str, Any]:
        return {"label": label, "done": bool(done)}

    if dream == "oga":
        ms = [m("Work your first shift", shifts >= 1), m("Earn a certificate", bool(certs)), m("Reach Senior level", lvl >= 2), m("Reach Lead level", lvl >= 3), m("Become the Oga at the top", lvl >= 4)]
    elif dream == "landlord":
        ms = [m("Save 10M ks", worth >= 10_000_000), m("Rent your own flat", st.housing in ("rent", "own")), m("Net worth 50M ks", worth >= 50_000_000), m("Buy your own house", st.housing == "own"), m("Net worth 100M ks", worth >= 100_000_000)]
    elif dream == "trader":
        ms = [m("Work at the textile market", shifts >= 1), m("Study Business Administration", "business_admin" in certs), m("Open your own business", bool(st.business_kind)), m("Take 10M ks in sales", st.business_sales >= 10_000_000), m("Take 50M ks in sales", st.business_sales >= 50_000_000)]
    elif dream == "padi":
        ms = [m("Make your first friend", friends >= 1), m("2 close friends", friends >= 2), m("3 close friends", friends >= 3), m("4 best friends", friends >= 4)]
    else:
        ms = [m("Pay with Lightning once", sats_pays >= 1), m("5 Lightning payments", sats_pays >= 5), m("10 Lightning payments", sats_pays >= 10)]
    done = sum(1 for x in ms if x["done"])
    return {"dream": dream, "milestones": ms, "done": done, "total": len(ms), "complete": done == len(ms)}


async def status(db: AsyncSession, player_id: str) -> dict[str, Any]:
    st = await life_state(db, player_id)
    await db.commit()
    e = await enrollment(db, player_id)
    certs = await certificates(db, player_id)
    shifts = await shifts_worked(db, player_id)
    lvl, title = career_level(shifts)
    paid = _aware(st.rent_paid_at)
    rent_due = st.housing == "rent" and (not paid or _now() - paid >= RENT_PERIOD)
    return {
        "housing": st.housing,
        "rent_due": rent_due,
        "car_tier": st.car_tier,
        "car_name": CARS[st.car_tier][0] if st.car_tier in CARS else None,
        "car": ({"tier": st.car_tier, "color": st.car_color or CAR_COLORS[0], "plate": st.car_plate or _plate(player_id),
                 "x": st.car_x, "z": st.car_z, "heading": st.car_heading, "region": st.car_region} if st.car_tier else None),
        "car_colors": CAR_COLORS,
        "business": {"kind": st.business_kind, "name": st.business_name, "sales": st.business_sales, "level": st.business_level, "stock": st.business_stock} if st.business_kind else None,
        "enrollment": enrollment_out(e),
        "certificates": [{"course": c, "name": COURSES[c]["name"]} for c in certs],
        "career_level": {"level": lvl, "title": title, "shifts": shifts},
        "pro_careers": [{"id": k, **v, "unlocked": v["needs"] in certs} for k, v in PRO_CAREERS.items()],
        "prices": {
            "rent": RENT,
            "house": HOUSE_PRICE,
            "cars": {str(k): {"name": v[0], "price": v[1]} for k, v in CARS.items()},
            "businesses": {k: {"name": v[0], "price": v[1], "daily": v[2]} for k, v in BUSINESSES.items()},
            "schools": {k: {"name": v["name"], "fee": v["fee"], "lectures": v["lectures"]} for k, v in SCHOOLS.items()},
            "courses": {k: v["name"] for k, v in COURSES.items()},
        },
        "balance": await balance(db, player_id),
    }
