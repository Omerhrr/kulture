"""Shared FastAPI dependencies - authN/authZ + uniform error envelope."""

from __future__ import annotations

import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.db.session import get_db
from app.models.player import PlayerProfile, User

bearer = HTTPBearer(auto_error=False)


async def get_current_profile(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> PlayerProfile:
    if creds is None or not creds.credentials:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing_token")
    claims = decode_access_token(creds.credentials)
    if not claims or "pid" not in claims:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid_token")
    profile = await _active_profile(db, claims["pid"])
    if not profile:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "player_not_found")
    return profile


async def _active_profile(db: AsyncSession, pid: str) -> PlayerProfile | None:
    """The token's player, only while their account is active (a disabled
    account is locked out at once, not when its token expires)."""
    return (
        await db.execute(
            select(PlayerProfile)
            .join(User, User.id == PlayerProfile.user_id)
            .where(PlayerProfile.id == pid, User.status == "active")
        )
    ).scalar_one_or_none()


async def get_current_profile_ws(token: str, db: AsyncSession) -> PlayerProfile | None:
    claims = decode_access_token(token)
    if not claims or "pid" not in claims:
        return None
    return await _active_profile(db, claims["pid"])


def error(code: str, message: str, status_code: int = 400, retryable: bool = False):
    """Uniform error envelope: {code, message, request_id, retryable}."""
    return HTTPException(
        status_code=status_code,
        detail={
            "code": code,
            "message": message,
            "request_id": uuid.uuid4().hex[:12],
            "retryable": retryable,
        },
    )
