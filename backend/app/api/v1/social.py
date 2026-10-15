"""Relationships, NPC chat, dating, dates, weddings, contacts and DMs."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import error, get_current_profile
from app.db.session import get_db
from app.events.bus import manager
from app.events.presence import presence
from app.models.player import PlayerProfile
from app.services import social_service as ss
from app.services.social_service import SocialError

router = APIRouter(prefix="/social", tags=["social"])

MSG = {
    "no_such_person": "Couldn't find that person.",
    "bad_place": "Pick restaurant, cinema or park.",
    "not_interested": "Get to know them a bit first.",
    "insufficient_funds": "Not enough naira for that.",
    "no_date": "You're not on a date.",
    "bad_choice": "Pick one of the options.",
    "already_engaged": "You're already engaged.",
    "not_engaged": "You need to be engaged first.",
    "empty": "Say something.",
}


def _err(e: SocialError):
    c = str(e)
    return error(c, MSG.get(c, c), 404 if c == "no_such_person" else 409)


class ChatIn(BaseModel):
    npc_id: str = Field(max_length=64)
    name: str | None = Field(default=None, max_length=64)
    text: str = Field(max_length=400)


class LikeIn(BaseModel):
    kind: str = Field(pattern="^(npc|player)$")
    id: str = Field(max_length=64)


class DateIn(BaseModel):
    rel_id: str
    place: str


class ChoiceIn(BaseModel):
    rel_id: str
    choice: int


class RelIn(BaseModel):
    rel_id: str


class DmIn(BaseModel):
    to: str
    text: str = Field(max_length=500)


@router.get("/relationships")
async def rels(profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return {"relationships": await ss.contacts(db, profile.id), "nearby": presence.nearby(profile.id)}


@router.post("/npc-chat")
async def npc_chat(body: ChatIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    try:
        return await ss.npc_chat(db, profile.id, profile.display_name, body.npc_id, body.name, body.text)
    except SocialError as e:
        raise _err(e)


class MetIn(BaseModel):
    npc_id: str = Field(max_length=64)
    name: str = Field(max_length=64)


@router.post("/met")
async def met(body: MetIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return {"relationship": await _wrap(ss.met(db, profile.id, profile.display_name, body.npc_id, body.name))}


@router.get("/dating")
async def dating(profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return {"people": await ss.dating_feed(db, profile.id), "places": {k: {"name": v[0], "cost": v[1]} for k, v in ss.DATE_PLACES.items()},
            "ring_price": ss.RING_PRICE, "wedding_price": ss.WEDDING_PRICE}


async def _wrap(coro):
    try:
        return await coro
    except SocialError as e:
        raise _err(e)


@router.post("/like")
async def like(body: LikeIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    out = await _wrap(ss.like(db, profile.id, body.kind, body.id))
    if body.kind == "player":
        await manager.send_to_player(body.id, {"type": "social.like", "payload": {"from": profile.id, "name": profile.display_name, "match": out["match"]}})
    return out


@router.post("/date/start")
async def date_start(body: DateIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await _wrap(ss.start_date(db, profile.id, body.rel_id, body.place))


@router.post("/date/choose")
async def date_choose(body: ChoiceIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await _wrap(ss.date_choose(db, profile.id, body.rel_id, body.choice))


@router.post("/propose")
async def propose(body: RelIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await _wrap(ss.propose(db, profile.id, body.rel_id))


@router.post("/wedding")
async def wedding(body: RelIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await _wrap(ss.wedding(db, profile.id, body.rel_id))


@router.post("/dm")
async def dm(body: DmIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    m = await _wrap(ss.send_dm(db, profile.id, body.to, body.text))
    out = ss.dm_out(m)
    await manager.send_to_player(body.to, {"type": "social.dm", "payload": {**out, "name": profile.display_name}})
    return {"message": out}


@router.get("/dm/{other}")
async def dm_thread(other: str, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return {"messages": await ss.thread(db, profile.id, other)}
