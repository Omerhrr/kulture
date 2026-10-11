"""Auth routes: register / login."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import error
from app.db.session import get_db
from app.schemas.auth import LoginIn, RegisterIn, TokenOut
from app.services import player_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenOut, status_code=201)
async def register(body: RegisterIn, db: AsyncSession = Depends(get_db)) -> TokenOut:
    try:
        return await player_service.register_player(
            db, body.username, body.password, body.display_name
        )
    except player_service.AuthError as exc:
        code = str(exc)
        if code == "username_taken":
            raise error("username_taken", "That username is already taken.", 409)
        raise error("world_not_seeded", "World is not initialized yet.", 503, retryable=True)


@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, db: AsyncSession = Depends(get_db)) -> TokenOut:
    try:
        return await player_service.login_player(db, body.username, body.password)
    except player_service.AuthError:
        raise error("invalid_credentials", "Invalid username or password.", 401)
