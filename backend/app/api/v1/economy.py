"""Business (shop) routes + job lifecycle routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import error, get_current_profile
from app.db.session import get_db
from app.models.player import PlayerProfile
from app.schemas.auth import PlayerOut
from app.schemas.game import BusinessOut, JobOut
from app.services import jobs_service, player_service, shop_service

router = APIRouter(tags=["economy"])


@router.get("/businesses/{business_id}", response_model=BusinessOut)
async def get_business(
    business_id: str,
    profile: PlayerProfile = Depends(get_current_profile),
    db: AsyncSession = Depends(get_db),
) -> BusinessOut:
    biz = await shop_service.get_business_out(db, business_id)
    if not biz:
        raise error("business_not_found", "Unknown business.", 404)
    return biz


@router.get("/jobs/available", response_model=list[JobOut])
async def available_jobs(
    business_id: str | None = None,
    profile: PlayerProfile = Depends(get_current_profile),
    db: AsyncSession = Depends(get_db),
) -> list[JobOut]:
    return await shop_service.list_available_jobs(db, business_id)


@router.get("/jobs/mine", response_model=list[JobOut])
async def my_jobs(
    profile: PlayerProfile = Depends(get_current_profile),
    db: AsyncSession = Depends(get_db),
) -> list[JobOut]:
    return await shop_service.my_jobs(db, profile.id)


@router.post("/jobs/{job_id}/accept", response_model=JobOut)
async def accept_job(
    job_id: str,
    profile: PlayerProfile = Depends(get_current_profile),
    db: AsyncSession = Depends(get_db),
) -> JobOut:
    try:
        job = await jobs_service.accept_job(db, profile.id, job_id)
    except jobs_service.JobError as exc:
        raise error("job_error", str(exc), 422)
    return await _job_out(db, job)


@router.post("/jobs/{job_id}/pickup", response_model=JobOut)
async def pickup_job(
    job_id: str,
    body: dict,
    profile: PlayerProfile = Depends(get_current_profile),
    db: AsyncSession = Depends(get_db),
) -> JobOut:
    position = body.get("position") if isinstance(body, dict) else None
    if not position or len(position) < 3:
        raise error("invalid_position", "position [x,y,z] is required", 422)
    try:
        job = await jobs_service.pickup_job(db, profile.id, job_id, float(position[0]), float(position[2]))
    except jobs_service.JobError as exc:
        raise error("job_error", str(exc), 422)
    return await _job_out(db, job)


@router.post("/jobs/{job_id}/complete", response_model=PlayerOut)
async def complete_job(
    job_id: str,
    body: dict,
    profile: PlayerProfile = Depends(get_current_profile),
    db: AsyncSession = Depends(get_db),
) -> PlayerOut:
    position = body.get("position") if isinstance(body, dict) else None
    if not position or len(position) < 3:
        raise error("invalid_position", "position [x,y,z] is required", 422)
    try:
        await jobs_service.complete_job(db, profile.id, job_id, float(position[0]), float(position[2]))
    except jobs_service.JobError as exc:
        raise error("job_error", str(exc), 422)
    out = await player_service.get_player_out(db, profile.user_id)
    assert out is not None
    return out


async def _job_out(db: AsyncSession, job) -> JobOut:
    from app.services.shop_service import _job_out_with_entities

    return await _job_out_with_entities(db, job)
