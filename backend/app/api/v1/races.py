"""Street races: checkpoint routes on real Kaduna roads + leaderboard."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import error, get_current_profile
from app.db.session import get_db
from app.models.life import RaceTime
from app.models.player import PlayerProfile
from app.services import life_service

router = APIRouter(prefix="/races", tags=["races"])

# Route ids, names, length (m) and the prize. Checkpoints live client-side on the road graph;
# the server only sanity-checks times against the route length (max ~70 m/s average).
ROUTES: dict[str, dict[str, Any]] = {
    "ahmadu_bello_sprint": {"name": "Ahmadu Bello Way Sprint", "length": 1900, "prize": 300_000},
    "bridge_dash": {"name": "River Kaduna Bridge Dash", "length": 1450, "prize": 250_000},
    "barnawa_loop": {"name": "Kachia Road Night Run", "length": 3600, "prize": 500_000},
}
MAX_SPEED = 70.0

# every other town gets a highway sprint and a market dash (routes are laid
# on that town's roads by the client; lengths here are conservative minimums)
from app.services.travel_service import REGIONS as _TOWNS  # noqa: E402

for _rid, _r in _TOWNS.items():
    if _rid == "kaduna":
        continue
    ROUTES[f"{_rid}_sprint"] = {"name": f"{_r['name']} Highway Sprint", "length": 900, "prize": 200_000}
    ROUTES[f"{_rid}_dash"] = {"name": f"{_r['name']} Market Dash", "length": 600, "prize": 150_000}


class TimeIn(BaseModel):
    route: str
    ms: int = Field(gt=0)
    position: int = Field(default=1, ge=1, le=8)


async def board(db: AsyncSession, route: str) -> list[dict[str, Any]]:
    rows = (await db.execute(select(RaceTime.name, RaceTime.player_id, func.min(RaceTime.ms).label("best")).where(RaceTime.route == route)
                             .group_by(RaceTime.player_id, RaceTime.name).order_by("best").limit(10))).all()
    return [{"name": r.name, "player_id": r.player_id, "ms": r.best} for r in rows]


@router.get("")
async def routes(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return {"routes": [{"id": k, **v, "leaderboard": await board(db, k)} for k, v in ROUTES.items()]}


@router.post("/time")
async def post_time(body: TimeIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    r = ROUTES.get(body.route)
    if not r:
        raise error("unknown_route", "That route doesn't exist.", 404)
    if body.ms < r["length"] / MAX_SPEED * 1000:
        raise error("implausible_time", "That time is impossible.", 422)
    prev = (await db.execute(select(func.min(RaceTime.ms)).where(RaceTime.route == body.route, RaceTime.player_id == profile.id))).scalar_one()
    best = prev is None or body.ms < prev
    db.add(RaceTime(player_id=profile.id, name=profile.display_name, route=body.route, ms=body.ms))
    prize = r["prize"] if body.position == 1 else r["prize"] // 3 if body.position == 2 else 0
    if not best:
        prize = 0  # prizes only for a new personal best (no farming)
    if prize:
        life_service.credit(db, profile.id, prize, "race_prize", f"{r['name']} · P{body.position}")
    await db.commit()
    return {"ok": True, "personal_best": best, "prize": prize, "leaderboard": await board(db, body.route)}
