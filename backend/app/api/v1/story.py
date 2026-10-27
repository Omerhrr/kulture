"""Main story routes: where you are in it, and talking to its people."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import error, get_current_profile
from app.db.session import get_db
from app.models.player import PlayerProfile
from app.services import story_service
from app.services.story_service import StoryError

router = APIRouter(prefix="/story", tags=["story"])

_MESSAGES = {
    "too_far_from_giver": "Walk up to them first.",
    "story_place_missing": "That place isn't on the map yet.",
}


class TalkIn(BaseModel):
    npc: str = Field(min_length=1, max_length=64)


@router.get("")
async def get_story(profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await story_service.state(db, profile.id)


@router.post("/talk")
async def talk(body: TalkIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    try:
        return await story_service.talk(db, profile.id, body.npc)
    except StoryError as exc:
        code = str(exc)
        raise error(code, _MESSAGES.get(code, code), 409)
