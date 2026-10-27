"""Characters. A player chooses only how they look and their name; the game
gives them a life: a background (well-off, middle class or self-made), a
dream, and a home in a Kaduna neighbourhood that fits that background.
New characters start at home: the server moves them there on creation.

Homes are points in real neighbourhoods (bake units from the OSM places,
scaled by settings.world_scale); the client resolves the family house
nearest the point, so every player gets their own house.
"""

from __future__ import annotations

import hashlib
import math
import random
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.events.presence import clean_look
from app.models.character import Character
from app.models.player import PlayerState
from app.services import life_service

# neighbourhood -> raw (bake) coordinates, from scripts/kaduna-osm places
AREAS: dict[str, tuple[float, float]] = {
    "Malali": (256, -230), "Nasarawa GRA": (120, -60), "Ungwan Rimi": (240, 40),
    "Narayi": (123, 678), "Ungwan Boro": (180, 800), "Unguwan Dosa": (153, -396), "Anadariya": (-2, -59), "Kawo": (182, -587),
    "Tudun Nupawa": (-211, 208), "Kakuri": (-332, 874), "Makera": (-300, 740), "Kinkinau": (-394, 448), "Badiko": (-281, -141), "Television": (-243, 968),
}
BIRTHS: dict[str, dict[str, Any]] = {
    "nepo": {"weight": 15, "areas": ["Malali", "Nasarawa GRA", "Ungwan Rimi"], "cash": 3_000_000, "own_flat": True},
    "middle": {"weight": 45, "areas": ["Narayi", "Ungwan Boro", "Unguwan Dosa", "Anadariya", "Kawo"], "cash": 1_000_000, "own_flat": False},
    "hustle": {"weight": 40, "areas": ["Tudun Nupawa", "Kakuri", "Makera", "Kinkinau", "Badiko", "Television"], "cash": 0, "own_flat": False},
}
DREAMS = ["oga", "landlord", "trader", "padi", "sats"]
HOME_JITTER = 110.0  # m around the neighbourhood centre
HOME_RADIUS = 180.0  # "at home" (arrival, commute home) within this of the point


class CharacterError(Exception):
    pass


def out(c: Character) -> dict[str, Any]:
    b = BIRTHS[c.birth]
    return {
        "name": c.name, "look": c.look or {}, "birth": c.birth, "dream": c.dream,
        "home": {"area": c.home_area, "x": c.home_x, "z": c.home_z},
        "perks": {"cash": b["cash"], "own_flat": b["own_flat"]},
    }


def _clean_name(name: str) -> str:
    n = " ".join(str(name).replace("@", "").split())[:18]
    if len(n) < 2:
        raise CharacterError("bad_name")
    return n


def _assign(player_id: str, birth: str | None = None) -> tuple[str, str, str, float, float]:
    """The life: random, but the same answer for the same player id (a
    given background is kept, e.g. an older Sim's)."""
    rnd = random.Random(int(hashlib.sha256(player_id.encode()).hexdigest()[:16], 16))
    rolled = rnd.choices(list(BIRTHS), weights=[b["weight"] for b in BIRTHS.values()])[0]
    birth = birth if birth in BIRTHS else rolled
    area = rnd.choice(BIRTHS[birth]["areas"])
    dream = rnd.choice(DREAMS)
    k = settings.world_scale
    ax, az = AREAS[area]
    a, r = rnd.uniform(0, 2 * math.pi), HOME_JITTER * math.sqrt(rnd.random())
    return birth, dream, area, ax * k + math.cos(a) * r, az * k + math.sin(a) * r


async def get(db: AsyncSession, player_id: str) -> Character | None:
    return await db.get(Character, player_id)


async def create(db: AsyncSession, player_id: str, name: str, look: Any, legacy: dict[str, Any] | None = None) -> Character:
    """Make the character (once): their look and name, the life we give
    them, the background's perks, and put them at home."""
    if await db.get(Character, player_id):
        raise CharacterError("already_created")
    # a Sim made before the server kept characters keeps the life it had
    birth, dream, area, hx, hz = _assign(player_id, (legacy or {}).get("birth"))
    if legacy and legacy.get("dream") in DREAMS:
        dream = legacy["dream"]
    c = Character(player_id=player_id, name=_clean_name(name), look=clean_look(look), birth=birth, dream=dream, home_area=area, home_x=hx, home_z=hz)
    db.add(c)
    perks = BIRTHS[birth]
    if perks["cash"] and not legacy:
        life_service.credit(db, player_id, perks["cash"], "birth_gift", "From your family: a start in life", ref=f"birth:{player_id}")
    if perks["own_flat"]:
        st = await life_service.life_state(db, player_id)
        st.housing = "rent"
        st.rent_paid_at = datetime.now(timezone.utc)
    # start at home
    ps = await db.get(PlayerState, (await _state_id(db, player_id)))
    if ps is not None and not legacy:
        ps.position_x, ps.position_y, ps.position_z = hx, 0.0, hz
        ps.state_version += 1
    await db.commit()
    return c


async def _state_id(db: AsyncSession, player_id: str) -> str | None:
    from sqlalchemy import select

    return (await db.execute(select(PlayerState.id).where(PlayerState.player_id == player_id))).scalar_one_or_none()


async def update(db: AsyncSession, player_id: str, name: str | None, look: Any) -> Character:
    c = await db.get(Character, player_id)
    if c is None:
        raise CharacterError("no_character")
    if name is not None:
        c.name = _clean_name(name)
    if look is not None:
        c.look = clean_look(look)
    await db.commit()
    return c


async def arrive_home(db: AsyncSession, player_id: str, x: float, z: float) -> tuple[float, float]:
    """Put the player at their own front door (the client knows which house
    is theirs; the server only accepts a spot close to their home point)."""
    c = await db.get(Character, player_id)
    if c is None:
        raise CharacterError("no_character")
    if not (math.isfinite(x) and math.isfinite(z)) or math.hypot(x - c.home_x, z - c.home_z) > HOME_RADIUS:
        raise CharacterError("not_your_home")
    ps = await db.get(PlayerState, await _state_id(db, player_id))
    if ps is None:
        raise CharacterError("no_character")
    ps.position_x, ps.position_y, ps.position_z = x, 0.0, z
    ps.state_version += 1
    await db.commit()
    return x, z
