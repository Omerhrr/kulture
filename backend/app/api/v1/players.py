"""Player routes: profile, inventory, transactions."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_profile
from app.db.session import get_db
from app.models.player import PlayerProfile
from app.schemas.auth import InventoryOut, PlayerOut, TransactionOut
from app.services import inventory_service, player_service

router = APIRouter(prefix="/players", tags=["players"])


@router.get("/me", response_model=PlayerOut)
async def me(
    profile: PlayerProfile = Depends(get_current_profile),
    db: AsyncSession = Depends(get_db),
) -> PlayerOut:
    out = await player_service.get_player_out(db, profile.user_id)
    assert out is not None
    return out


@router.get("/me/inventory", response_model=InventoryOut)
async def my_inventory(
    profile: PlayerProfile = Depends(get_current_profile),
    db: AsyncSession = Depends(get_db),
) -> InventoryOut:
    return await inventory_service.get_inventory_out(db, profile.id)


@router.get("/me/transactions", response_model=list[TransactionOut])
async def my_transactions(
    profile: PlayerProfile = Depends(get_current_profile),
    db: AsyncSession = Depends(get_db),
) -> list[TransactionOut]:
    rows = await player_service.ledger_entries(db, profile.id)
    return [
        TransactionOut(
            id=r.id,
            entry_type=r.entry_type,
            asset_type=r.asset_type,
            amount_minor_units=r.amount_minor_units,
            description=r.description,
            transaction_reference=r.transaction_reference,
            created_at=r.created_at,
        )
        for r in rows
    ]
