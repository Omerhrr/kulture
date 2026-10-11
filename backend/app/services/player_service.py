"""Player service - identity, profiles, authoritative state, NGN ledger views."""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import create_access_token, hash_password, verify_password
from app.models.business import NPCAgent
from app.models.catalog import Inventory
from app.models.ledger import GameLedgerEntry
from app.models.player import PlayerProfile, PlayerState, User
from app.models.world import WorldEntity, WorldRegion
from app.schemas.auth import PlayerOut, TokenOut

STARTING_NGN_MINOR = 25_000_00  # ₦25,000.00 simulated - clearly a game currency
STARTING_REPUTATION = 0


class AuthError(Exception):
    pass


def _token_for(user: User, profile: PlayerProfile) -> TokenOut:
    return TokenOut(
        access_token=create_access_token(user.id, {"pid": profile.id}),
        player_id=profile.id,
    )


async def register_player(
    db: AsyncSession, username: str, password: str, display_name: str
) -> TokenOut:
    existing = (await db.execute(select(User).where(User.username == username))).scalar_one_or_none()
    if existing:
        raise AuthError("username_taken")

    region = (
        await db.execute(select(WorldRegion).where(WorldRegion.slug == "ali-akilu-road"))
    ).scalar_one_or_none()
    if region is None:
        raise AuthError("world_not_seeded")

    spawn = (
        await db.execute(select(WorldEntity).where(WorldEntity.code == "spawn_roadside"))
    ).scalar_one()

    user = User(username=username, password_hash=hash_password(password), status="active")
    db.add(user)
    await db.flush()

    profile = PlayerProfile(
        user_id=user.id, display_name=display_name or username, reputation=STARTING_REPUTATION
    )
    db.add(profile)
    await db.flush()

    state = PlayerState(
        player_id=profile.id,
        region_id=region.id,
        position_x=spawn.position_x,
        position_y=spawn.position_y,
        position_z=spawn.position_z,
    )
    db.add(state)

    db.add(
        GameLedgerEntry(
            account_reference=f"player:{profile.id}",
            asset_type="ngn_minor",
            amount_minor_units=STARTING_NGN_MINOR,
            transaction_reference=f"grant:{user.id}:{datetime.now(timezone.utc).timestamp():.0f}",
            entry_type="grant_initial",
            description="Starting simulated NGN (game currency - not Bitcoin)",
        )
    )
    await db.commit()
    return _token_for(user, profile)


async def login_player(db: AsyncSession, username: str, password: str) -> TokenOut:
    user = (await db.execute(select(User).where(User.username == username))).scalar_one_or_none()
    if not user or not verify_password(password, user.password_hash) or user.status != "active":
        raise AuthError("invalid_credentials")
    profile = (
        await db.execute(select(PlayerProfile).where(PlayerProfile.user_id == user.id))
    ).scalar_one()
    return _token_for(user, profile)


async def ngn_balance_minor(db: AsyncSession, player_id: str) -> int:
    total = await db.execute(
        select(func.coalesce(func.sum(GameLedgerEntry.amount_minor_units), 0)).where(
            GameLedgerEntry.account_reference == f"player:{player_id}",
            GameLedgerEntry.asset_type == "ngn_minor",
        )
    )
    return int(total.scalar_one())


async def get_player_out(db: AsyncSession, user_id: str) -> PlayerOut | None:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        return None
    profile = (
        await db.execute(select(PlayerProfile).where(PlayerProfile.user_id == user.id))
    ).scalar_one()
    state = (
        await db.execute(select(PlayerState).where(PlayerState.player_id == profile.id))
    ).scalar_one_or_none()
    balance = await ngn_balance_minor(db, profile.id)
    return PlayerOut(
        id=profile.id,
        user_id=user.id,
        username=user.username,
        display_name=profile.display_name,
        avatar_id=profile.avatar_id,
        reputation=profile.reputation,
        ngn_balance_minor=balance,
        position=(state.position_x, state.position_y, state.position_z) if state else None,
        region_id=state.region_id if state else None,
        state_version=state.state_version if state else 0,
        created_at=profile.created_at,
    )


async def player_state(db: AsyncSession, player_id: str) -> PlayerState:
    return (
        await db.execute(select(PlayerState).where(PlayerState.player_id == player_id))
    ).scalar_one()


async def apply_movement(
    db: AsyncSession, player_id: str, x: float, y: float, z: float, facing: float
) -> PlayerState:
    """Server-side movement persistence. Bounds are enforced by the caller (WS handler)."""
    state = await player_state(db, player_id)
    state.position_x, state.position_y, state.position_z = x, y, z
    state.facing = facing
    state.state_version += 1
    state.last_seen_at = datetime.now(timezone.utc)
    await db.commit()
    return state


async def add_reputation(db: AsyncSession, player_id: str, delta: int) -> None:
    profile = (
        await db.execute(select(PlayerProfile).where(PlayerProfile.id == player_id))
    ).scalar_one()
    profile.reputation = max(0, profile.reputation + delta)


async def ledger_entries(db: AsyncSession, player_id: str, limit: int = 50) -> list[GameLedgerEntry]:
    rows = await db.execute(
        select(GameLedgerEntry)
        .where(GameLedgerEntry.account_reference == f"player:{player_id}")
        .order_by(GameLedgerEntry.created_at.desc())
        .limit(limit)
    )
    return list(rows.scalars())
