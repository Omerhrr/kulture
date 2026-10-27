"""Phone games: Whot, Ludo, Ayo, Naija Trivia - multiplayer with bot fill."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import error, get_current_profile
from app.db.session import get_db
from app.events.bus import manager
from app.models.player import PlayerProfile
from app.services import match_service as ms
from app.services.games_engine import GAMES
from app.services.match_service import MatchError

router = APIRouter(prefix="/games", tags=["games"])


def _err(e: MatchError):
    c = str(e)
    return error(c, c.replace("_", " ").capitalize() + ".", 404 if c in ("no_match", "unknown_game") else 409)


class JoinIn(BaseModel):
    game: str
    stake: int = Field(default=0, ge=0)
    asset: str = "ksats"
    vs_bots: bool = False
    invite: str | None = None  # friend's player id: private head-to-head
    match_id: str | None = None  # accept a friend's invite


class MoveIn(BaseModel):
    move: Any


async def _push(m, skip: str) -> None:
    for pid in await ms.humans(m):
        if pid != skip:
            await manager.send_to_player(pid, {"type": "game.update", "payload": {"id": m.id, "seq": m.seq}})


@router.get("")
async def catalog() -> dict[str, Any]:
    return {"games": [{"id": k, "name": v["name"], "seats": list(v["seats"])} for k, v in GAMES.items()], "stake_cap": ms.STAKE_CAP}


@router.get("/tables")
async def tables(profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return {"tables": await ms.tables(db)}


@router.post("/match/{mid}/start")
async def start_now(mid: str, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    try:
        m = await ms.start_now(db, profile.id, mid)
    except MatchError as e:
        raise _err(e)
    await _push(m, profile.id)
    return ms.view(m, profile.id)


@router.post("/join")
async def join(body: JoinIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    try:
        m = await ms.join(db, profile.id, profile.display_name, body.game, body.stake, body.asset, body.vs_bots, body.invite, body.match_id)
    except MatchError as e:
        raise _err(e)
    if body.invite:
        await manager.send_to_player(body.invite, {"type": "game.invite", "payload": {"id": m.id, "game": m.game, "name": m.players[0]["name"] if m.players else "", "from": profile.id, "game_name": ms.GAMES[m.game]["name"], "stake": m.stake}})
    await _push(m, profile.id)
    return ms.view(m, profile.id)


@router.get("/match/{mid}")
async def get_match(mid: str, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    try:
        m = await ms.tick(db, await ms.get(db, mid))
    except MatchError as e:
        raise _err(e)
    return ms.view(m, profile.id)


@router.post("/match/{mid}/move")
async def move(mid: str, body: MoveIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    try:
        m = await ms.move(db, profile.id, mid, body.move)
    except MatchError as e:
        raise _err(e)
    await _push(m, profile.id)
    return ms.view(m, profile.id)


@router.post("/match/{mid}/leave")
async def leave(mid: str, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    try:
        m = await ms.leave(db, profile.id, mid)
    except MatchError as e:
        raise _err(e)
    await _push(m, profile.id)
    return ms.view(m, profile.id)
