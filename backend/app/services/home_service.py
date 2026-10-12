"""Home furniture: catalog, ownership, layout, buy and sell (simulated NGN).

The server owns what you have and the money; the client only proposes
positions, which are bounds-checked. Selling refunds half the catalog price.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.home import HomeItem
from app.models.ledger import GameLedgerEntry
from app.services import player_service

# sku -> (name, price in kobo, category)
CATALOG: dict[str, tuple[str, int, str]] = {
    "sofa3": ("Three-seat sofa", 180_000_00, "Living"),
    "armchair": ("Armchair", 65_000_00, "Living"),
    "coffee_table": ("Glass coffee table", 40_000_00, "Living"),
    "tv_console": ("43\" TV + console", 220_000_00, "Living"),
    "rug": ("Ankara rug", 30_000_00, "Decor"),
    "floor_lamp": ("Floor lamp", 15_000_00, "Decor"),
    "snake_plant": ("Snake plant", 8_000_00, "Decor"),
    "bookshelf": ("Bookshelf", 45_000_00, "Living"),
    "standing_fan": ("Standing fan", 25_000_00, "Comfort"),
    "dining_set": ("Dining set (4 chairs)", 150_000_00, "Dining"),
    "plastic_chair": ("Plastic chair", 4_000_00, "Dining"),
    "bed_double": ("Double bed", 200_000_00, "Bedroom"),
    "wardrobe": ("Wardrobe", 90_000_00, "Bedroom"),
    "deep_freezer": ("Deep freezer", 160_000_00, "Kitchen"),
    "generator": ("Generator (I better pass my neighbour)", 120_000_00, "Comfort"),
}
# what every new home comes with (free)
STARTER = {"sofa3": 1, "armchair": 1, "coffee_table": 1, "tv_console": 1, "rug": 1, "floor_lamp": 1,
           "snake_plant": 2, "standing_fan": 1, "dining_set": 1, "bed_double": 1, "wardrobe": 1}
BOUND = 8.0
MAX_ITEMS = 60
SELL_RATE = 0.5


class HomeError(Exception):
    pass


def item_out(it: HomeItem) -> dict[str, Any]:
    return {"uid": it.id, "sku": it.sku, "x": round(it.x, 3), "z": round(it.z, 3), "rot": it.rot}


def catalog_out() -> list[dict[str, Any]]:
    return [{"sku": k, "name": n, "price_ngn_minor": p, "category": c, "sell_ngn_minor": int(p * SELL_RATE)} for k, (n, p, c) in CATALOG.items()]


async def items(db: AsyncSession, player_id: str) -> list[HomeItem]:
    return list((await db.execute(select(HomeItem).where(HomeItem.player_id == player_id))).scalars().all())


def _check_pos(x: float, z: float, rot: int) -> None:
    if not (-BOUND <= x <= BOUND and -BOUND <= z <= BOUND) or rot not in (0, 1, 2, 3):
        raise HomeError("bad_position")


async def init_layout(db: AsyncSession, player_id: str, layout: list[dict[str, Any]]) -> list[HomeItem]:
    """First visit: the client lays the starter furniture out for its room
    size. Only the starter set, only once."""
    if await items(db, player_id):
        raise HomeError("already_initialised")
    counts: dict[str, int] = {}
    rows = []
    for it in layout[:40]:
        sku = str(it.get("sku"))
        counts[sku] = counts.get(sku, 0) + 1
        if counts[sku] > STARTER.get(sku, 0):
            raise HomeError("not_starter_item")
        x, z, rot = float(it.get("x", 0)), float(it.get("z", 0)), int(it.get("rot", 0))
        _check_pos(x, z, rot)
        rows.append(HomeItem(player_id=player_id, sku=sku, x=x, z=z, rot=rot))
    db.add_all(rows)
    await db.commit()
    return rows


async def move(db: AsyncSession, player_id: str, uid: str, x: float, z: float, rot: int) -> HomeItem:
    _check_pos(x, z, rot)
    it = (await db.execute(select(HomeItem).where(HomeItem.id == uid, HomeItem.player_id == player_id))).scalar_one_or_none()
    if it is None:
        raise HomeError("not_found")
    it.x, it.z, it.rot = x, z, rot
    await db.commit()
    return it


async def buy(db: AsyncSession, player_id: str, sku: str, x: float = 0.0, z: float = 0.0) -> HomeItem:
    if sku not in CATALOG:
        raise HomeError("unknown_item")
    _check_pos(x, z, 0)
    if len(await items(db, player_id)) >= MAX_ITEMS:
        raise HomeError("home_full")
    name, price, _ = CATALOG[sku]
    if await player_service.ngn_balance_minor(db, player_id) < price:
        raise HomeError("insufficient_funds")
    it = HomeItem(player_id=player_id, sku=sku, x=x, z=z, rot=0)
    db.add(it)
    await db.flush()
    db.add(GameLedgerEntry(account_reference=f"player:{player_id}", asset_type="ngn_minor", amount_minor_units=-price,
                           transaction_reference=f"furniture_buy:{it.id}", entry_type="furniture_purchase", description=f"Bought {name}"))
    await db.commit()
    return it


async def sell(db: AsyncSession, player_id: str, uid: str) -> int:
    it = (await db.execute(select(HomeItem).where(HomeItem.id == uid, HomeItem.player_id == player_id))).scalar_one_or_none()
    if it is None:
        raise HomeError("not_found")
    name, price, _ = CATALOG.get(it.sku, (it.sku, 0, ""))
    refund = int(price * SELL_RATE)
    await db.delete(it)
    db.add(GameLedgerEntry(account_reference=f"player:{player_id}", asset_type="ngn_minor", amount_minor_units=refund,
                           transaction_reference=f"furniture_sell:{uid}:{uuid.uuid4().hex[:6]}", entry_type="furniture_sale", description=f"Sold {name}"))
    await db.commit()
    return refund
