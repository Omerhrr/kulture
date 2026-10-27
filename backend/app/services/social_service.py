"""People who matter: NPC + player relationships, chat with memory, dating,
dates with choices, proposals/weddings, contacts and direct messages."""

from __future__ import annotations

import random
import uuid
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.life import DirectMessage, Relationship
from app.models.player import PlayerProfile
from app.services import life_service


class SocialError(Exception):
    pass


# Dating-app personas (NPCs that live in the city). Their ids and names
# never reuse a story character's (npc_musa, npc_amina, npc_tunde... are the
# shopkeeper, the Stonetech coordinator, the freight officer).
PERSONAS: dict[str, dict[str, Any]] = {
    "npc_aisha": {"name": "Aisha", "gender": "female", "age": 24, "job": "Nurse at Barau Dikko", "likes": ["park", "restaurant"], "bio": "Suya lover, Kannywood critic, early riser."},
    "npc_zainab": {"name": "Zainab", "gender": "female", "age": 27, "job": "Banker, Ahmadu Bello Way", "likes": ["restaurant", "cinema"], "bio": "Numbers by day, novels by night."},
    "npc_grace": {"name": "Grace", "gender": "female", "age": 25, "job": "Choir singer & designer", "likes": ["cinema", "park"], "bio": "Ankara designs and Sunday harmonies."},
    "npc_halima": {"name": "Halima", "gender": "female", "age": 23, "job": "KASU medical student", "likes": ["park", "cinema"], "bio": "Future doctor. Fura da nono fan."},
    "npc_sadiq": {"name": "Sadiq", "gender": "male", "age": 28, "job": "Software developer", "likes": ["cinema", "restaurant"], "bio": "Codes in Barnawa, plays 5-a-side on Saturdays."},
    "npc_emeka": {"name": "Emeka", "gender": "male", "age": 30, "job": "Trader, Central Market", "likes": ["restaurant", "park"], "bio": "Hustler with a big heart. Pepper soup expert."},
    "npc_ibrahim": {"name": "Ibrahim", "gender": "male", "age": 26, "job": "Teacher, Kaduna Poly", "likes": ["park", "restaurant"], "bio": "Poetry, tea and long walks by the river."},
    "npc_kunle": {"name": "Kunle", "gender": "male", "age": 29, "job": "DJ at the bar", "likes": ["cinema", "restaurant"], "bio": "Afrobeats all day. I'll make you dance."},
}

GREETINGS = ["Sannu!", "Ina kwana?", "Ina wuni?", "Barka da yamma!", "Lafiya lau?", "Yaya aiki?"]
SMALLTALK = [
    "This harmattan dust no dey play o.", "NEPA took light again yesterday, generator saved me.",
    "Have you tried the suya near Murtala Square?", "Market day at Central Market is always busy.",
    "Kaduna is sweet when the evening breeze comes.", "Allah ya kiyaye, how is work?",
]

DATE_PLACES = {"restaurant": ("Dinner at a restaurant", 700_000), "cinema": ("Film at the cinema", 500_000), "park": ("Walk in the park", 0)}
RING_PRICE = 5_000_000
WEDDING_PRICE = 20_000_000

# 3 rounds per date; each option: (text, mood delta)
DATE_ROUNDS: list[dict[str, Any]] = [
    {"prompt": "{name} smiles as you sit down. What do you open with?",
     "options": [("Compliment their outfit sincerely", 12), ("Talk about yourself for ten minutes", -10), ("Ask about their day at work", 8)]},
    {"prompt": "{name} mentions their family back home in Zaria.",
     "options": [("Ask about them and really listen", 12), ("Check your phone", -15), ("Share a funny story about your own family", 6)]},
    {"prompt": "The evening is winding down. {name} looks at you.",
     "options": [("Offer to see them home safely", 10), ("Ask for a second date right now", 4), ("Split the bill to the kobo", -6)]},
]


# dating personas that used to share a story character's id: (old id, old
# name) -> (new id, new name). Applied to saved relationships on boot.
PERSONA_RENAMES: dict[str, tuple[str, str, str]] = {
    "npc_amina": ("Amina", "npc_aisha", "Aisha"),
    "npc_musa": ("Musa", "npc_sadiq", "Sadiq"),
    "npc_tunde": ("Tunde", "npc_kunle", "Kunle"),
}


async def migrate_persona_ids(db: AsyncSession) -> int:
    """Move relationships with the renamed dating personas to their new ids
    (only rows that are about the persona - same old name). Idempotent."""
    n = 0
    for old_id, (old_name, new_id, new_name) in PERSONA_RENAMES.items():
        rows = (await db.execute(select(Relationship).where(
            Relationship.other_kind == "npc", Relationship.other_id == old_id, Relationship.name == old_name))).scalars().all()
        for r in rows:
            r.other_id, r.name = new_id, new_name
            n += 1
    if n:
        await db.commit()
    return n


def _clamp(v: int) -> int:
    return max(0, min(100, v))


def rel_out(r: Relationship) -> dict[str, Any]:
    p = PERSONAS.get(r.other_id, {})
    return {"id": r.id, "kind": r.other_kind, "other_id": r.other_id, "name": r.name, "friendship": r.friendship,
            "romance": r.romance, "status": r.status, "memory": list(r.memory or [])[-5:], "job": p.get("job"),
            "gender": p.get("gender"),
            "on_date": bool((r.date_state or {}).get("place"))}


async def get_rel(db: AsyncSession, pid: str, kind: str, other_id: str, name: str | None = None) -> Relationship:
    r = (await db.execute(select(Relationship).where(Relationship.player_id == pid, Relationship.other_kind == kind, Relationship.other_id == other_id))).scalar_one_or_none()
    if r is None:
        if not name:
            if kind == "npc":
                name = PERSONAS.get(other_id, {}).get("name") or other_id.replace("npc_", "").replace("_", " ").title()
            else:
                prof = await db.get(PlayerProfile, other_id)
                if not prof:
                    raise SocialError("no_such_person")
                name = prof.display_name
        r = Relationship(id=str(uuid.uuid4()), player_id=pid, other_kind=kind, other_id=other_id, name=name[:64], friendship=0, romance=0, status="acquaintance", memory=[], date_state={})
        db.add(r)
        await db.flush()
    return r


def _remember(r: Relationship, note: str) -> None:
    r.memory = [*(r.memory or []), note[:120]][-12:]
    flag_modified(r, "memory")


def _restatus(r: Relationship) -> None:
    if r.status in ("engaged", "married"):
        return
    if r.romance >= 60:
        r.status = "partner"
    elif r.romance >= 30:
        r.status = "dating"
    elif r.friendship >= 80:
        r.status = "best_friend"
    elif r.friendship >= 40:
        r.status = "friend"
    else:
        r.status = "acquaintance"


async def relationships(db: AsyncSession, pid: str) -> list[dict[str, Any]]:
    rows = (await db.execute(select(Relationship).where(Relationship.player_id == pid).order_by(Relationship.friendship.desc()))).scalars().all()
    return [rel_out(r) for r in rows]


# --------------------------------------------------------------- NPC chat
async def npc_chat(db: AsyncSession, pid: str, me_name: str, npc_id: str, npc_name: str | None, text: str) -> dict[str, Any]:
    r = await get_rel(db, pid, "npc", npc_id, npc_name)
    first = not r.memory
    persona = PERSONAS.get(npc_id, {"job": "Kaduna resident", "bio": "Friendly local."})
    reply = None
    source = "scripted"
    try:
        from app.agents.llm_client import llm_client

        sys = (f"You are {r.name}, a {persona.get('job')} in Kaduna, Nigeria. {persona.get('bio')} "
               f"You speak warm Nigerian English with a little Hausa (Sannu, Ina kwana, Nagode, Allah ya kiyaye). "
               f"You are talking to {me_name}. Friendship {r.friendship}/100, romance {r.romance}/100. "
               f"Things you remember about them: {'; '.join(r.memory or []) or 'nothing yet, you just met'}. "
               "Reply in 1-2 short sentences, stay in character, never mention being an AI.")
        res = await llm_client.chat([{"role": "system", "content": sys}, {"role": "user", "content": text[:400]}], max_tokens=120, temperature=0.8)
        if res.ok and res.content.strip():
            reply, source = res.content.strip()[:400], "ai"
    except Exception:  # pragma: no cover - offline
        pass
    if reply is None:
        greet = random.choice(GREETINGS)
        if first:
            reply = f"{greet} I'm {r.name}. Nice to meet you, {me_name}."
        elif r.friendship >= 40:
            reply = f"{greet} {me_name}, my padi! {random.choice(SMALLTALK)}"
        else:
            reply = f"{greet} {random.choice(SMALLTALK)}"
    r.friendship = _clamp(r.friendship + (3 if len(text) > 12 else 1))
    if first:
        _remember(r, f"Met {me_name}")
    elif len(text) > 20 and random.random() < 0.35:
        _remember(r, f"{me_name} said: {text[:80]}")
    _restatus(r)
    await db.commit()
    return {"reply": reply, "source": source, "relationship": rel_out(r)}


async def met(db: AsyncSession, pid: str, me_name: str, npc_id: str, name: str) -> dict[str, Any]:
    """A street/world conversation: NPCs remember you and warm up slowly."""
    r = await get_rel(db, pid, "npc", npc_id, name)
    if not r.memory:
        _remember(r, f"Met {me_name} in town")
    r.friendship = _clamp(r.friendship + 2)
    _restatus(r)
    await db.commit()
    return rel_out(r)


# --------------------------------------------------------------- dating
async def dating_feed(db: AsyncSession, pid: str) -> list[dict[str, Any]]:
    out = [{"id": k, "kind": "npc", **{x: v[x] for x in ("name", "age", "job", "bio", "gender")}} for k, v in PERSONAS.items()]
    others = (await db.execute(select(PlayerProfile).where(PlayerProfile.id != pid).limit(12))).scalars().all()
    for p in others:
        out.append({"id": p.id, "kind": "player", "name": p.display_name, "age": None, "job": "Player", "bio": "A real person in Kaduna", "gender": None})
    return out


async def like(db: AsyncSession, pid: str, kind: str, other_id: str) -> dict[str, Any]:
    r = await get_rel(db, pid, kind, other_id)
    if kind == "npc":
        match = r.friendship >= 10 or random.random() < 0.6
    else:
        # mutual like: they must have liked you back
        back = (await db.execute(select(Relationship).where(Relationship.player_id == other_id, Relationship.other_kind == "player", Relationship.other_id == pid))).scalar_one_or_none()
        match = bool(back and back.romance >= 5)
    r.romance = _clamp(r.romance + 5)
    if match:
        r.friendship = _clamp(r.friendship + 5)
        _remember(r, "We matched on Kulture Connect")
    _restatus(r)
    await db.commit()
    return {"match": match, "relationship": rel_out(r)}


async def start_date(db: AsyncSession, pid: str, rel_id: str, place: str) -> dict[str, Any]:
    r = await db.get(Relationship, rel_id)
    if not r or r.player_id != pid:
        raise SocialError("no_such_person")
    if place not in DATE_PLACES:
        raise SocialError("bad_place")
    if r.romance < 5 and r.friendship < 20:
        raise SocialError("not_interested")
    label, cost = DATE_PLACES[place]
    try:
        await life_service.charge(db, pid, cost, "date", f"{label} with {r.name}")
    except life_service.LifeError:
        raise SocialError("insufficient_funds")
    r.date_state = {"place": place, "round": 0, "mood": 50 + random.randint(-10, 10), "log": []}
    flag_modified(r, "date_state")
    await db.commit()
    return date_view(r)


def date_view(r: Relationship) -> dict[str, Any]:
    ds = r.date_state or {}
    rnd = ds.get("round", 0)
    cur = None
    if ds.get("place") and rnd < len(DATE_ROUNDS):
        d = DATE_ROUNDS[rnd]
        cur = {"prompt": d["prompt"].format(name=r.name), "options": [o[0] for o in d["options"]]}
    return {"relationship": rel_out(r), "place": ds.get("place"), "round": rnd, "rounds": len(DATE_ROUNDS), "mood": ds.get("mood"), "step": cur, "log": ds.get("log", [])}


async def date_choose(db: AsyncSession, pid: str, rel_id: str, choice: int) -> dict[str, Any]:
    r = await db.get(Relationship, rel_id)
    if not r or r.player_id != pid or not (r.date_state or {}).get("place"):
        raise SocialError("no_date")
    ds = dict(r.date_state)
    d = DATE_ROUNDS[ds["round"]]
    if not 0 <= choice < len(d["options"]):
        raise SocialError("bad_choice")
    text, delta = d["options"][choice]
    if ds["place"] in PERSONAS.get(r.other_id, {}).get("likes", []):
        delta += 3
    ds["mood"] = _clamp(ds["mood"] + delta + random.randint(-3, 3))
    ds["log"] = [*ds["log"], {"you": text, "delta": delta}]
    ds["round"] += 1
    out: dict[str, Any] = {}
    if ds["round"] >= len(DATE_ROUNDS):
        mood = ds["mood"]
        outcome = "great" if mood >= 70 else "okay" if mood >= 45 else "bad"
        gain = {"great": 18, "okay": 6, "bad": -8}[outcome]
        r.romance = _clamp(r.romance + gain)
        r.friendship = _clamp(r.friendship + max(2, gain // 2))
        _remember(r, f"Date at the {ds['place']} went {outcome}")
        out = {"finished": True, "outcome": outcome, "romance_change": gain}
        ds = {}
        _restatus(r)
    r.date_state = ds
    flag_modified(r, "date_state")
    await db.commit()
    return {**date_view(r), **out}


async def propose(db: AsyncSession, pid: str, rel_id: str) -> dict[str, Any]:
    r = await db.get(Relationship, rel_id)
    if not r or r.player_id != pid:
        raise SocialError("no_such_person")
    if r.status in ("engaged", "married"):
        raise SocialError("already_engaged")
    try:
        await life_service.charge(db, pid, RING_PRICE, "ring", f"Engagement ring for {r.name}")
    except life_service.LifeError:
        raise SocialError("insufficient_funds")
    accepted = r.romance >= 85
    if accepted:
        r.status = "engaged"
        _remember(r, "Said YES to the proposal")
    else:
        r.romance = _clamp(r.romance - 10)
        _remember(r, "A proposal came too soon")
        life_service.credit(db, pid, RING_PRICE // 2, "ring_return", "Returned the ring (half refund)")
    await db.commit()
    return {"accepted": accepted, "relationship": rel_out(r)}


async def wedding(db: AsyncSession, pid: str, rel_id: str) -> dict[str, Any]:
    r = await db.get(Relationship, rel_id)
    if not r or r.player_id != pid or r.status != "engaged":
        raise SocialError("not_engaged")
    try:
        await life_service.charge(db, pid, WEDDING_PRICE, "wedding", f"Wedding & owambe with {r.name}")
    except life_service.LifeError:
        raise SocialError("insufficient_funds")
    r.status = "married"
    r.romance = 100
    _remember(r, "Our wedding owambe - the whole of Kaduna came")
    from app.services import player_service

    await player_service.add_reputation(db, pid, 30)
    await db.commit()
    return {"married": True, "relationship": rel_out(r)}


# --------------------------------------------------------------- DMs
async def send_dm(db: AsyncSession, pid: str, to_id: str, text: str) -> DirectMessage:
    if to_id == pid or not await db.get(PlayerProfile, to_id):
        raise SocialError("no_such_person")
    text = text.strip()[:500]
    if not text:
        raise SocialError("empty")
    m = DirectMessage(id=str(uuid.uuid4()), from_id=pid, to_id=to_id, text=text, read=False)
    db.add(m)
    a = await get_rel(db, pid, "player", to_id)
    b = await get_rel(db, to_id, "player", pid)
    a.friendship = _clamp(a.friendship + 1)
    b.friendship = _clamp(b.friendship + 1)
    await db.commit()
    return m


def dm_out(m: DirectMessage) -> dict[str, Any]:
    return {"id": m.id, "from": m.from_id, "to": m.to_id, "text": m.text, "read": m.read, "at": m.created_at.isoformat() if m.created_at else None}


async def thread(db: AsyncSession, pid: str, other: str) -> list[dict[str, Any]]:
    rows = (await db.execute(select(DirectMessage).where(or_(
        (DirectMessage.from_id == pid) & (DirectMessage.to_id == other),
        (DirectMessage.from_id == other) & (DirectMessage.to_id == pid))).order_by(DirectMessage.created_at).limit(200))).scalars().all()
    for m in rows:
        if m.to_id == pid and not m.read:
            m.read = True
    await db.commit()
    return [dm_out(m) for m in rows]


async def contacts(db: AsyncSession, pid: str) -> list[dict[str, Any]]:
    rels = await relationships(db, pid)
    unread: dict[str, int] = {}
    rows = (await db.execute(select(DirectMessage).where(DirectMessage.to_id == pid, DirectMessage.read.is_(False)))).scalars().all()
    for m in rows:
        unread[m.from_id] = unread.get(m.from_id, 0) + 1
    for r in rels:
        r["unread"] = unread.get(r["other_id"], 0) if r["kind"] == "player" else 0
    return rels
