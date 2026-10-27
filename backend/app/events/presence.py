"""Live presence: who is online, where they stand, what they look like.

In-memory (single API process, like the socket manager). Positions come
only from moves the server already ACCEPTED (speed envelope + bounds), so
other players see the authoritative position, never raw client claims.
A 1 Hz loop sends each player the people near them plus the real online
count.
"""

from __future__ import annotations

import asyncio
import math
import re
import time
from dataclasses import dataclass, field
from typing import Any

from app.core.config import settings
from app.events.bus import manager

NEAR_RADIUS = 260.0  # units: how far away other players are streamed
MAX_NEARBY = 40
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
_LOOK_ENUMS = {
    "body": {"man", "woman"},
    # current hairstyles + the older names (still sent by older clients)
    "hair": {"lowcut", "fade", "afro", "puff", "cornrows", "braids", "locs", "bald", "cap"},
    "outfit": {"kaftan", "dress", "shirt"},  # legacy
    "topStyle": {"tee", "polo", "longsleeve", "shirt", "tank"},
    "bottomStyle": {"jeans", "trousers", "shorts", "skirt"},
    "shoes": {"sneakers", "shoes", "sandals", "boots"},
    "beard": {"none", "stubble", "full"},
}
_LOOK_COLORS = ("skin", "hairColor", "top", "bottom", "shoeColor")
# face + build sliders (0..1), see frontend utils/people.ts
_LOOK_SHAPES = {
    "heavy", "slim", "muscular", "noseWide", "noseFlare", "noseSmall", "lipsFull", "mouthWide", "jawWide",
    "chinStrong", "cheekbones", "eyesBig", "forehead", "earsSmall", "headRound", "headOval", "headSquare",
}


def clean_look(raw: Any) -> dict[str, Any]:
    """Whitelist a client look payload: known enums, #rrggbb colours and
    face/build sliders clamped to 0..1 only."""
    out: dict[str, Any] = {}
    if not isinstance(raw, dict):
        return out
    for k, allowed in _LOOK_ENUMS.items():
        v = raw.get(k)
        if isinstance(v, str) and v in allowed:
            out[k] = v
    for k in _LOOK_COLORS:
        v = raw.get(k)
        if isinstance(v, str) and _HEX.match(v):
            out[k] = v
    shape = raw.get("shape")
    if isinstance(shape, dict):
        clean: dict[str, float] = {}
        for k, v in shape.items():
            if k in _LOOK_SHAPES and isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
                clean[k] = round(min(1.0, max(0.0, float(v))), 3)
        if clean:
            out["shape"] = clean
    return out


@dataclass
class Presence:
    player_id: str
    name: str
    pos: list[float]
    facing: float = 0.0
    look: dict[str, str] = field(default_factory=dict)
    moving: bool = False
    riding: str | None = None  # vehicle kind while commuting/driving
    region: str = "kaduna-city"  # which town's map the player is in
    updated: float = field(default_factory=time.monotonic)


class PresenceRegistry:
    def __init__(self) -> None:
        self._p: dict[str, Presence] = {}
        self._task: asyncio.Task | None = None

    def join(self, player_id: str, name: str, pos: list[float], region: str = "kaduna-city") -> None:
        cur = self._p.get(player_id)
        if cur:
            cur.name = name
            cur.region = region
            cur.pos = list(pos)
            return
        self._p[player_id] = Presence(player_id, name, list(pos), region=region)
        self._ensure_loop()

    def leave(self, player_id: str) -> None:
        if not manager.is_online(player_id):
            self._p.pop(player_id, None)

    def move(self, player_id: str, pos: list[float], facing: float) -> None:
        p = self._p.get(player_id)
        if not p:
            return
        p.moving = abs(pos[0] - p.pos[0]) + abs(pos[2] - p.pos[2]) > 0.05
        p.pos = list(pos)
        p.facing = facing
        p.updated = time.monotonic()

    def set_look(self, player_id: str, look: dict[str, str], name: str | None = None) -> None:
        p = self._p.get(player_id)
        if p:
            p.look = look
            if name:
                p.name = name

    def set_riding(self, player_id: str, kind: str | None) -> None:
        p = self._p.get(player_id)
        if p:
            p.riding = kind

    def near(self, player_id: str, radius: float) -> list[Presence]:
        me = self._p.get(player_id)
        if not me:
            return []
        out = []
        for p in self._p.values():
            if p.player_id != player_id and p.region == me.region and math.hypot(p.pos[0] - me.pos[0], p.pos[2] - me.pos[2]) <= radius:
                out.append(p)
        return out

    def melee_target(self, player_id: str, reach: float = 1.7) -> tuple[Presence, list[float]] | None:
        """Nearest other player within reach roughly in front of the attacker
        (server positions + facing, never client claims)."""
        me = self._p.get(player_id)
        if not me:
            return None
        fx, fz = math.sin(me.facing), math.cos(me.facing)
        best = None
        for p in self.near(player_id, reach):
            dx, dz = p.pos[0] - me.pos[0], p.pos[2] - me.pos[2]
            d = math.hypot(dx, dz) or 1e-6
            if (dx * fx + dz * fz) / d < 0.2:  # behind / beside: miss
                continue
            if best is None or d < best[1]:
                best = (p, d, [dx / d, dz / d])
        return (best[0], best[2]) if best else None

    def online_count(self) -> int:
        return len(self._p)

    def nearby(self, player_id: str) -> list[dict[str, Any]]:
        me = self._p.get(player_id)
        if not me:
            return []
        out = []
        for p in self._p.values():
            if p.player_id == player_id or p.region != me.region:
                continue
            dx = p.pos[0] - me.pos[0]
            dz = p.pos[2] - me.pos[2]
            d2 = dx * dx + dz * dz
            if d2 <= NEAR_RADIUS * NEAR_RADIUS:
                out.append((d2, p))
        out.sort(key=lambda t: t[0])
        return [
            {
                "id": p.player_id,
                "name": p.name,
                "pos": [round(v, 2) for v in p.pos],
                "facing": round(p.facing, 3),
                "look": p.look,
                "moving": p.moving and time.monotonic() - p.updated < 1.2,
                "riding": p.riding,
            }
            for _, p in out[:MAX_NEARBY]
        ]

    def _ensure_loop(self) -> None:
        if self._task is None or self._task.done():
            try:
                self._task = asyncio.get_running_loop().create_task(self._loop())
            except RuntimeError:
                self._task = None

    async def _loop(self) -> None:
        while self._p:
            await asyncio.sleep(settings.presence_snapshot_interval_seconds)
            count = self.online_count()
            for pid in list(self._p.keys()):
                await manager.send_to_player(
                    pid,
                    {"type": "players.snapshot", "payload": {"online": count, "players": self.nearby(pid)}},
                )


presence = PresenceRegistry()
