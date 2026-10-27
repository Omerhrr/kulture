"""Auth routes: register / login."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import error
from app.core.config import settings
from app.core.ratelimit import SlidingWindow
from app.db.session import get_db
from app.schemas.auth import LoginIn, RegisterIn, TokenOut
from app.services import player_service

router = APIRouter(prefix="/auth", tags=["auth"])

_register_ip = SlidingWindow(settings.auth_register_per_ip_per_hour, 3600)
_login_ip = SlidingWindow(settings.auth_login_per_ip_per_10min, 600)
_login_fail_user = SlidingWindow(settings.auth_failed_login_per_user_per_10min, 600)


def _ip(request: Request) -> str:
    # uvicorn runs with --proxy-headers, so this is the player's real address
    return request.client.host if request.client else "?"


def _slow_down(wait: float, what: str):
    mins = max(1, round(wait / 60))
    return error("rate_limited", f"Too many {what}. Try again in about {mins} minute{'s' if mins > 1 else ''}.", 429, retryable=True)


@router.post("/register", response_model=TokenOut, status_code=201)
async def register(body: RegisterIn, request: Request, db: AsyncSession = Depends(get_db)) -> TokenOut:
    ip = _ip(request)
    if wait := _register_ip.blocked(ip):
        raise _slow_down(wait, "new accounts from your network")
    _register_ip.hit(ip)
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
async def login(body: LoginIn, request: Request, db: AsyncSession = Depends(get_db)) -> TokenOut:
    ip = _ip(request)
    user_key = player_service.normalize_username(body.username)
    if wait := (_login_fail_user.blocked(user_key) or _login_ip.blocked(ip)):
        raise _slow_down(wait, "login attempts")
    _login_ip.hit(ip)
    try:
        token = await player_service.login_player(db, body.username, body.password)
    except player_service.AuthError:
        _login_fail_user.hit(user_key)
        raise error("invalid_credentials", "Wrong username or password.", 401)
    _login_fail_user.reset(user_key)
    return token
