"""Phone arcade: high scores + leaderboards for the single-player games."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import error, get_current_profile
from app.db.session import get_db
from app.models.life import ArcadeScore
from app.models.player import PlayerProfile

router = APIRouter(prefix="/arcade", tags=["arcade"])

# game id -> max plausible score (rejects obviously forged posts)
GAMES = {"snake": 2_000, "runner": 10_000, "brawl": 20_000, "stick": 5_000, "okada": 100_000, "blocks": 500_000}


class ScoreIn(BaseModel):
    game: str
    score: int = Field(ge=0)


async def board(db: AsyncSession, game: str) -> list[dict[str, Any]]:
    rows = (await db.execute(
        select(ArcadeScore.player_id, ArcadeScore.name, func.max(ArcadeScore.score).label("best"))
        .where(ArcadeScore.game == game).group_by(ArcadeScore.player_id, ArcadeScore.name).order_by(func.max(ArcadeScore.score).desc()).limit(10)
    )).all()
    return [{"player_id": r.player_id, "name": r.name, "score": r.best} for r in rows]


@router.get("/{game}")
async def leaderboard(game: str, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    if game not in GAMES:
        raise error("unknown_game", "Unknown game.", 404)
    mine = (await db.execute(select(func.max(ArcadeScore.score)).where(ArcadeScore.game == game, ArcadeScore.player_id == profile.id))).scalar_one()
    return {"game": game, "leaderboard": await board(db, game), "best": mine or 0}


@router.post("/score")
async def post_score(body: ScoreIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    if body.game not in GAMES:
        raise error("unknown_game", "Unknown game.", 404)
    if body.score > GAMES[body.game]:
        raise error("implausible_score", "That score isn't possible.", 422)
    prev = (await db.execute(select(func.max(ArcadeScore.score)).where(ArcadeScore.game == body.game, ArcadeScore.player_id == profile.id))).scalar_one() or 0
    db.add(ArcadeScore(player_id=profile.id, name=profile.display_name, game=body.game, score=body.score))
    await db.commit()
    return {"best": max(prev, body.score), "new_best": body.score > prev, "leaderboard": await board(db, body.game)}
