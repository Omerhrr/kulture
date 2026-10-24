"""Life progression: school, housing, cars, businesses, dream milestones."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import error, get_current_profile
from app.db.session import get_db
from app.models.player import PlayerProfile
from app.services import life_service as ls
from app.services.life_service import LifeError

router = APIRouter(prefix="/life", tags=["life"])

MSG = {
    "insufficient_funds": "Not enough k-sats for that.",
    "unknown_course": "That course isn't offered.",
    "already_enrolled": "Finish your current course first.",
    "already_certified": "You already hold that certificate.",
    "not_enrolled": "Enrol at a school first.",
    "lectures_first": "Attend all your lectures before the exam.",
    "ready_for_exam": "Lectures done - time to sit the exam.",
    "no_session": "No lecture or exam in progress.",
    "already_own": "You already own a house.",
    "rent_not_due": "Rent is paid up for now.",
    "bad_car": "Pick a better car than the one you drive.",
    "no_car": "You don't own a car yet (Phone → Life).",
    "bad_color": "Pick one of the paint colours.",
    "bad_business": "Unknown business type.",
    "already_have_business": "You already run a business.",
    "not_ready_for_business": "Move out of the family house or earn a Business Admin certificate first.",
    "no_business": "You don't own a business.",
    "nothing_to_collect": "No takings yet - come back later.",
}


def _err(e: LifeError):
    c = str(e)
    return error(c, MSG.get(c, c), 409)


class EnrollIn(BaseModel):
    school: str
    course: str


class SessionIn(BaseModel):
    kind: str = Field(pattern="^(lecture|exam)$")


class AnswersIn(BaseModel):
    answers: dict[str, int]


class CarIn(BaseModel):
    tier: int
    color: str | None = None


class ParkIn(BaseModel):
    x: float = Field(ge=-20000, le=20000, allow_inf_nan=False)
    z: float = Field(ge=-20000, le=20000, allow_inf_nan=False)
    heading: float = Field(default=0.0, ge=-100, le=100, allow_inf_nan=False)


class PaintIn(BaseModel):
    color: str


class BizIn(BaseModel):
    kind: str
    name: str = Field(default="", max_length=48)


@router.get("/status")
async def status(profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await ls.status(db, profile.id)


@router.get("/dream/{dream}")
async def dream(dream: str, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    out = await ls.dream_progress(db, profile.id, dream)
    await db.commit()
    return out


@router.post("/enroll")
async def enroll(body: EnrollIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    try:
        return {"enrollment": ls.enrollment_out(await ls.enroll(db, profile.id, body.school, body.course))}
    except LifeError as e:
        raise _err(e)


@router.post("/session")
async def session(body: SessionIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    try:
        return await ls.start_session(db, profile.id, body.kind)
    except LifeError as e:
        raise _err(e)


@router.post("/session/submit")
async def submit(body: AnswersIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    try:
        return await ls.submit_session(db, profile.id, body.answers)
    except LifeError as e:
        raise _err(e)


async def _do(coro, db, pid):
    try:
        await coro
    except LifeError as e:
        raise _err(e)
    return await ls.status(db, pid)


@router.post("/rent")
async def rent(profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await _do(ls.rent(db, profile.id), db, profile.id)


@router.post("/house")
async def house(profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await _do(ls.buy_house(db, profile.id), db, profile.id)


@router.post("/car")
async def car(body: CarIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await _do(ls.buy_car(db, profile.id, body.tier, body.color), db, profile.id)


@router.post("/car/paint")
async def car_paint(body: PaintIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await _do(ls.paint_car(db, profile.id, body.color), db, profile.id)


@router.post("/car/park")
async def car_park(body: ParkIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    from app.services.travel_service import region_of

    try:
        await ls.park_car(db, profile.id, await region_of(db, profile.id), body.x, body.z, body.heading)
    except LifeError as e:
        raise _err(e)
    return {"ok": True}


@router.get("/cars")
async def cars(profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    from app.services.travel_service import region_of

    return {"cars": await ls.parked_cars(db, await region_of(db, profile.id))}


@router.post("/business")
async def business(body: BizIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await _do(ls.open_business(db, profile.id, body.kind, body.name), db, profile.id)


@router.post("/business/collect")
async def collect(profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    from app.services import society_service as ss

    try:
        r = await ss.collect(db, profile.id)
    except ss.SocietyError as e:
        raise error(str(e), MSG.get(str(e), "Nothing to collect yet."), 409)
    return {"collected": max(0, r["net"]), "report": r, "status": await ls.status(db, profile.id)}


@router.get("/businesses")
async def businesses(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return {"businesses": await ls.businesses(db)}


# ------------------------------------------------------------ social events
# Prize money for winning a social event (dance battle at the bar, talent
# show at the cinema, 5-a-side at the park). Server-capped with a cooldown so
# it can't be farmed.
EVENT_PRIZES = {"dance_battle": 250_000, "talent_show": 400_000, "football": 300_000}
EVENT_COOLDOWN_S = 300


class EventIn(BaseModel):
    event: str
    won: bool


@router.post("/event")
async def event_result(body: EventIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import select

    from app.models.ledger import GameLedgerEntry
    from app.services import player_service

    if body.event not in EVENT_PRIZES:
        raise error("unknown_event", "Unknown event.", 404)
    prize = 0
    if body.won:
        last = (await db.execute(select(GameLedgerEntry.created_at).where(
            GameLedgerEntry.account_reference == f"player:{profile.id}", GameLedgerEntry.entry_type == f"event_{body.event}"
        ).order_by(GameLedgerEntry.created_at.desc()).limit(1))).scalar_one_or_none()
        if last is not None and last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        if last is None or datetime.now(timezone.utc) - last > timedelta(seconds=EVENT_COOLDOWN_S):
            prize = EVENT_PRIZES[body.event]
            ls.credit(db, profile.id, prize, f"event_{body.event}", body.event.replace("_", " ").title() + " winner")
            await player_service.add_reputation(db, profile.id, 3)
    await db.commit()
    return {"prize": prize}
