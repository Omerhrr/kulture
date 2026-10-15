"""Careers + workplace shift routes (server-authoritative pay)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import error, get_current_profile
from app.db.session import get_db
from app.models.player import PlayerProfile
from app.services import shift_service
from app.services.shift_service import ShiftError

router = APIRouter(prefix="/work", tags=["work"])


async def _region(db: AsyncSession, pid: str) -> str:
    from app.services.travel_service import SLUG_TO_ID, region_of

    return SLUG_TO_ID.get(await region_of(db, pid), "kaduna")

_MESSAGES = {
    "unknown_career": "That job doesn't exist.",
    "shift_already_active": "You're already on a shift.",
    "not_at_workplace": "Get to your workplace first.",
    "no_active_shift": "You're not on a shift.",
    "task_too_soon": "Take a breather - the next task opens soon.",
    "workplace_missing": "Workplace not found.",
    "wrong_town": "That job is in another town - travel there first.",
    "certificate_required": "You need a certificate for this job (Phone → School).",
}


def _err(exc: ShiftError):
    code = str(exc)
    return error(code, _MESSAGES.get(code, code), 409 if code != "unknown_career" else 404)


class ClockIn(BaseModel):
    career: str


@router.get("/state")
async def state(profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return {
        "careers": await shift_service.careers_out(db, await _region(db, profile.id)),
        "shift": shift_service.shift_out(await shift_service.active_shift(db, profile.id)),
    }


@router.post("/clock-in")
async def clock_in(body: ClockIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    try:
        return {"shift": shift_service.shift_out(await shift_service.clock_in(db, profile.id, body.career))}
    except ShiftError as exc:
        raise _err(exc)


@router.post("/task")
async def task(profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    try:
        return {"shift": shift_service.shift_out(await shift_service.record_task(db, profile.id))}
    except ShiftError as exc:
        raise _err(exc)


@router.post("/clock-out")
async def clock_out(profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    try:
        return {"shift": shift_service.shift_out(await shift_service.clock_out(db, profile.id))}
    except ShiftError as exc:
        raise _err(exc)
