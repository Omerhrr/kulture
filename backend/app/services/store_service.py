"""Player stores: the shelf of a shop a player owns (Phone → Business), and
buying from it.

- Owners stock goods at the city's wholesale price (60% of the cheapest an
  NPC shop charges) or shelve items from their own bag, and set their
  price within a sane band around wholesale.
- Customers buy with k-sats, in the store (walk in) or from the phone
  (delivery, +10%). The owner is paid at once, less a 5% market levy;
  the goods land in the customer's bag. Restaurants sell food only.
- Every sale runs under the buyer's charge lock and an idempotency key, so
  a double tap never charges twice and stock never goes negative.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import ShopListing
from app.models.catalog import Inventory, Item
from app.models.ledger import GameLedgerEntry
from app.models.life import LifeState
from app.models.player import PlayerProfile
from app.models.store import ShelfItem
from app.services import inventory_service
from app.services import life_service as ls

WHOLESALE_PCT = 60
LEVY_PCT = 5
DELIVERY_PCT = 10
MAX_STOCK = 99
PRICE_MIN_PCT = 50  # of wholesale
PRICE_MAX_PCT = 500
SHELF_SLOTS = {1: 6, 2: 10, 3: 16}  # by business level (shop / supermarket / mall)


class StoreError(Exception):
    pass


async def wholesale(db: AsyncSession) -> dict[str, tuple[Item, int]]:
    """item code -> (item, wholesale price): everything the city's shops sell."""
    rows = (
        await db.execute(
            select(Item, func.min(ShopListing.price_ksats)).join(ShopListing, ShopListing.item_id == Item.id).where(Item.item_type != "quest").group_by(Item.id)
        )
    ).all()
    return {it.code: (it, max(1_000, int(p) * WHOLESALE_PCT // 100)) for it, p in rows}


async def _store(db: AsyncSession, owner_id: str) -> LifeState:
    st = await db.get(LifeState, owner_id)
    if not st or not st.business_kind:
        raise StoreError("no_store")
    return st


def _sells(st: LifeState, item: Item) -> bool:
    return st.business_kind != "restaurant" or item.item_type == "food"


async def _owner_name(db: AsyncSession, pid: str) -> str:
    p = await db.get(PlayerProfile, pid)
    return p.display_name if p else "Someone"


async def _shelf_rows(db: AsyncSession, owner_id: str) -> list[tuple[ShelfItem, Item]]:
    return list((await db.execute(select(ShelfItem, Item).join(Item, Item.id == ShelfItem.item_id).where(ShelfItem.owner_id == owner_id).order_by(Item.name))).all())


def _line(s: ShelfItem, it: Item) -> dict[str, Any]:
    return {"item": it.code, "name": it.name, "emoji": it.emoji, "type": it.item_type, "description": it.description, "price": s.price_ksats, "stock": s.stock, "sold": s.sold}


# ---------------------------------------------------------------- browsing
async def directory(db: AsyncSession) -> list[dict[str, Any]]:
    """Every open player store, with what's on its shelves right now."""
    stores = (await db.execute(select(LifeState).where(LifeState.business_kind.is_not(None)))).scalars().all()
    counts = dict((await db.execute(select(ShelfItem.owner_id, func.count()).where(ShelfItem.stock > 0).group_by(ShelfItem.owner_id))).all())
    out = []
    for st in stores:
        out.append({
            "owner_id": st.player_id, "owner": await _owner_name(db, st.player_id), "name": st.business_name, "kind": st.business_kind,
            "level": st.business_level, "products": int(counts.get(st.player_id, 0)),
        })
    out.sort(key=lambda s: (-s["products"], s["name"] or ""))
    return out


async def store(db: AsyncSession, owner_id: str) -> dict[str, Any]:
    st = await _store(db, owner_id)
    return {
        "owner_id": owner_id, "owner": await _owner_name(db, owner_id), "name": st.business_name, "kind": st.business_kind, "level": st.business_level,
        "shelf": [_line(s, it) for s, it in await _shelf_rows(db, owner_id) if s.stock > 0],
        "delivery_pct": DELIVERY_PCT,
    }


# ---------------------------------------------------------------- buying
async def buy(db: AsyncSession, buyer_id: str, owner_id: str, item_code: str, qty: int, delivery: bool, key: str | None) -> dict[str, Any]:
    if not 1 <= qty <= 10:
        raise StoreError("bad_quantity")
    if buyer_id == owner_id:
        raise StoreError("own_store")
    key = (key or uuid.uuid4().hex)[:64]
    ref = f"store:{buyer_id}:{key}"
    if (await db.execute(select(GameLedgerEntry.id).where(GameLedgerEntry.transaction_reference == ref + ":pay"))).first():
        return {"repeat": True, "balance": await ls.balance(db, buyer_id)}
    st = await _store(db, owner_id)
    row = (await db.execute(select(ShelfItem, Item).join(Item, Item.id == ShelfItem.item_id).where(ShelfItem.owner_id == owner_id, Item.code == item_code))).first()
    if not row:
        raise StoreError("not_on_shelf")
    shelf, item = row
    if shelf.stock < qty:
        raise StoreError("out_of_stock")
    goods = shelf.price_ksats * qty
    fee = goods * DELIVERY_PCT // 100 if delivery else 0
    buyer = await _owner_name(db, buyer_id)
    try:
        await ls.charge(db, buyer_id, goods + fee, "store_purchase", f"{item.name} x{qty} at {st.business_name}" + (" (delivered)" if delivery else ""),
                        ref=ref + ":pay", meta={"store": owner_id, "item": item.code, "qty": qty, "fee": fee})
    except ls.LifeError:
        raise StoreError("insufficient_funds")
    # take the stock in one conditional UPDATE: two buyers can't both get the last one
    took = await db.execute(
        update(ShelfItem).where(ShelfItem.id == shelf.id, ShelfItem.stock >= qty).values(stock=ShelfItem.stock - qty, sold=ShelfItem.sold + qty)
    )
    if took.rowcount != 1:
        await db.rollback()
        raise StoreError("out_of_stock")
    takings = goods - goods * LEVY_PCT // 100
    ls.credit(db, owner_id, takings, "store_sale", f"{buyer} bought {item.name} x{qty}", ref=ref + ":sale", meta={"buyer": buyer_id, "item": item.code, "qty": qty})
    st.business_sales += takings
    await inventory_service.grant_items(db, buyer_id, item.id, qty, reference=ref)
    await db.commit()
    return {"item": item.code, "name": item.name, "qty": qty, "paid": goods + fee, "fee": fee, "owner_got": takings, "store": st.business_name,
            "buyer": buyer, "balance": await ls.balance(db, buyer_id)}


# ---------------------------------------------------------------- running it
async def mine(db: AsyncSession, owner_id: str) -> dict[str, Any]:
    st = await _store(db, owner_id)
    ws = await wholesale(db)
    bag = (await db.execute(select(Inventory, Item).join(Item, Item.id == Inventory.item_id).where(Inventory.player_id == owner_id, Inventory.quantity > 0))).all()
    return {
        "name": st.business_name, "kind": st.business_kind, "level": st.business_level,
        "slots": SHELF_SLOTS.get(st.business_level, 6),
        "shelf": [{**_line(s, it), "wholesale": ws.get(it.code, (it, 0))[1]} for s, it in await _shelf_rows(db, owner_id)],
        "catalog": [{"item": c, "name": it.name, "emoji": it.emoji, "type": it.item_type, "wholesale": p} for c, (it, p) in sorted(ws.items(), key=lambda x: x[1][0].name) if _sells(st, it)],
        "bag": [{"item": it.code, "name": it.name, "emoji": it.emoji, "qty": inv.quantity} for inv, it in bag if it.item_type != "quest" and _sells(st, it)],
        "levy_pct": LEVY_PCT,
        "balance": await ls.balance(db, owner_id),
    }


async def _shelf_for(db: AsyncSession, st: LifeState, item: Item, price: int) -> ShelfItem:
    s = (await db.execute(select(ShelfItem).where(ShelfItem.owner_id == st.player_id, ShelfItem.item_id == item.id))).scalar_one_or_none()
    if s:
        return s
    used = (await db.execute(select(func.count()).select_from(ShelfItem).where(ShelfItem.owner_id == st.player_id))).scalar_one()
    if used >= SHELF_SLOTS.get(st.business_level, 6):
        raise StoreError("shelf_full")
    s = ShelfItem(owner_id=st.player_id, item_id=item.id, price_ksats=price, stock=0)
    db.add(s)
    await db.flush()
    return s


async def restock(db: AsyncSession, owner_id: str, item_code: str, qty: int) -> dict[str, Any]:
    """Buy goods at wholesale onto the shelf."""
    st = await _store(db, owner_id)
    ws = await wholesale(db)
    if item_code not in ws:
        raise StoreError("not_wholesale")
    item, price = ws[item_code]
    if not _sells(st, item):
        raise StoreError("wrong_kind")
    if not 1 <= qty <= MAX_STOCK:
        raise StoreError("bad_quantity")
    s = await _shelf_for(db, st, item, price * 13 // 10)
    if s.stock + qty > MAX_STOCK:
        raise StoreError("shelf_full")
    try:
        await ls.charge(db, owner_id, price * qty, "store_restock", f"Wholesale: {item.name} x{qty}")
    except ls.LifeError:
        raise StoreError("insufficient_funds")
    s.stock += qty
    await db.commit()
    return await mine(db, owner_id)


async def shelve(db: AsyncSession, owner_id: str, item_code: str, qty: int) -> dict[str, Any]:
    """Put items from your bag on the shelf."""
    st = await _store(db, owner_id)
    item = (await db.execute(select(Item).where(Item.code == item_code))).scalar_one_or_none()
    if not item or item.item_type == "quest":
        raise StoreError("not_sellable")
    if not _sells(st, item):
        raise StoreError("wrong_kind")
    if not 1 <= qty <= MAX_STOCK:
        raise StoreError("bad_quantity")
    ws = await wholesale(db)
    s = await _shelf_for(db, st, item, ws.get(item_code, (item, 100_000))[1] * 13 // 10)
    if s.stock + qty > MAX_STOCK:
        raise StoreError("shelf_full")
    if not await inventory_service.consume_items(db, owner_id, item.id, qty):
        raise StoreError("not_in_bag")
    s.stock += qty
    await db.commit()
    return await mine(db, owner_id)


async def set_price(db: AsyncSession, owner_id: str, item_code: str, price: int) -> dict[str, Any]:
    await _store(db, owner_id)
    row = (await db.execute(select(ShelfItem, Item).join(Item, Item.id == ShelfItem.item_id).where(ShelfItem.owner_id == owner_id, Item.code == item_code))).first()
    if not row:
        raise StoreError("not_on_shelf")
    shelf, item = row
    base = (await wholesale(db)).get(item_code, (item, shelf.price_ksats))[1]
    if not base * PRICE_MIN_PCT // 100 <= price <= base * PRICE_MAX_PCT // 100:
        raise StoreError("bad_price")
    shelf.price_ksats = price
    await db.commit()
    return await mine(db, owner_id)


async def unshelve(db: AsyncSession, owner_id: str, item_code: str) -> dict[str, Any]:
    """Take a product off the shelf; what's left goes back to your bag."""
    await _store(db, owner_id)
    row = (await db.execute(select(ShelfItem, Item).join(Item, Item.id == ShelfItem.item_id).where(ShelfItem.owner_id == owner_id, Item.code == item_code))).first()
    if not row:
        raise StoreError("not_on_shelf")
    shelf, item = row
    if shelf.stock > 0:
        await inventory_service.grant_items(db, owner_id, item.id, shelf.stock, reference=f"unshelve:{shelf.id}:{uuid.uuid4().hex[:6]}")
    await db.delete(shelf)
    await db.commit()
    return await mine(db, owner_id)
