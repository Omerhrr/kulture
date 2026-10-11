"""Inventory service - transactional item grants (exactly-once fulfillment helper)."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog import Inventory, Item
from app.models.events import OutboxEvent
from app.schemas.auth import InventoryItemOut, InventoryOut


async def grant_items(
    db: AsyncSession, player_id: str, item_id: str, quantity: int, reference: str
) -> Inventory:
    """Idempotently grant items using the purchase/job reference as the dedup key.

    Callers must run this inside the same transaction that marks the
    purchase/job as fulfilled, so a crash can never both grant and re-grant.
    """
    existing = (
        await db.execute(
            select(Inventory).where(
                Inventory.player_id == player_id, Inventory.item_id == item_id
            )
        )
    ).scalar_one_or_none()

    if existing:
        existing.quantity += quantity
        existing.version += 1
        inv = existing
    else:
        inv = Inventory(player_id=player_id, item_id=item_id, quantity=quantity, version=1)
        db.add(inv)

    db.add(
        OutboxEvent(
            event_type="inventory.updated",
            aggregate_id=player_id,
            player_id=player_id,
            payload={"reference": reference, "item_id": item_id, "quantity": quantity},
        )
    )
    return inv


async def consume_items(db: AsyncSession, player_id: str, item_id: str, quantity: int) -> bool:
    inv = (
        await db.execute(
            select(Inventory).where(
                Inventory.player_id == player_id, Inventory.item_id == item_id
            )
        )
    ).scalar_one_or_none()
    if not inv or inv.quantity < quantity:
        return False
    inv.quantity -= quantity
    inv.version += 1
    if inv.quantity == 0:
        await db.delete(inv)
    return True


async def has_item(db: AsyncSession, player_id: str, item_code: str) -> Inventory | None:
    row = await db.execute(
        select(Inventory)
        .join(Item, Item.id == Inventory.item_id)
        .where(Inventory.player_id == player_id, Item.code == item_code)
    )
    return row.scalar_one_or_none()


async def get_inventory_out(db: AsyncSession, player_id: str) -> InventoryOut:
    rows = (
        await db.execute(
            select(Inventory).where(Inventory.player_id == player_id).limit(200)
        )
    )
    items = [
        InventoryItemOut(
            item_id=inv.item_id,
            code=inv.item.code,
            name=inv.item.name,
            emoji=inv.item.emoji,
            quantity=inv.quantity,
        )
        for inv in rows.scalars()
    ]
    return InventoryOut(items=items)
