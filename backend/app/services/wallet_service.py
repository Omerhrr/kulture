"""Wallet: send k-sats to another player, find people to pay, and the
history of what you sent and received.

A transfer is two ledger rows (your debit, their credit) written in one
transaction, under the same per-player charge lock purchases use, so a
double tap or two tabs can never overdraw. The client's idempotency key
makes a retried request return the first result instead of paying twice.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ledger import GameLedgerEntry
from app.models.player import PlayerProfile, User
from app.services import life_service as ls

SEND_MIN = 1_000
SEND_MAX = 10_000_000  # per transfer
DAILY_MAX = 50_000_000  # sent per rolling 24 h
NOTE_MAX = 80


class WalletError(Exception):
    pass


async def _person(db: AsyncSession, who: str) -> PlayerProfile | None:
    """A player by profile id or @username."""
    who = who.strip()
    p = await db.get(PlayerProfile, who) if not who.startswith("@") else None
    if p:
        return p
    name = who.lstrip("@").lower()
    return (
        await db.execute(select(PlayerProfile).join(User, User.id == PlayerProfile.user_id).where(func.lower(User.username) == name))
    ).scalar_one_or_none()


def _card(p: PlayerProfile, username: str) -> dict[str, Any]:
    return {"id": p.id, "name": p.display_name, "username": username}


async def people(db: AsyncSession, pid: str, q: str, limit: int = 12) -> list[dict[str, Any]]:
    """Players whose name or username matches, for the recipient picker."""
    q = re.sub(r"[%_\\]", "", q.strip().lstrip("@"))[:32]
    if len(q) < 2:
        return []
    like = f"%{q.lower()}%"
    rows = (
        await db.execute(
            select(PlayerProfile, User.username)
            .join(User, User.id == PlayerProfile.user_id)
            .where(PlayerProfile.id != pid, User.status == "active", or_(func.lower(User.username).like(like), func.lower(PlayerProfile.display_name).like(like)))
            .order_by(func.length(User.username))
            .limit(limit)
        )
    ).all()
    return [_card(p, u) for p, u in rows]


async def _sent_today(db: AsyncSession, pid: str) -> int:
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    v = await db.execute(
        select(func.coalesce(func.sum(GameLedgerEntry.amount_minor_units), 0)).where(
            GameLedgerEntry.account_reference == f"player:{pid}",
            GameLedgerEntry.entry_type == "transfer_out",
            GameLedgerEntry.created_at >= since,
        )
    )
    return -int(v.scalar_one())


async def send(db: AsyncSession, pid: str, to: str, amount: int, note: str = "", key: str | None = None) -> dict[str, Any]:
    key = (key or uuid.uuid4().hex)[:64]
    ref = f"transfer:{pid}:{key}"
    done = (await db.execute(select(GameLedgerEntry).where(GameLedgerEntry.transaction_reference == ref + ":out"))).scalar_one_or_none()
    if done:
        # the same request again (retry, double tap): the first answer
        m = done.metadata_json or {}
        return {"id": key, "to": m.get("to"), "amount": -done.amount_minor_units, "note": m.get("note", ""), "balance": await ls.balance(db, pid), "repeat": True}
    if not isinstance(amount, int) or amount < SEND_MIN or amount > SEND_MAX:
        raise WalletError("bad_amount")
    other = await _person(db, to)
    if other is None or other.id == pid:
        raise WalletError("no_such_person")
    me = await db.get(PlayerProfile, pid)
    if await _sent_today(db, pid) + amount > DAILY_MAX:
        raise WalletError("daily_limit")
    note = " ".join(note.split())[:NOTE_MAX]
    my_user = (await db.execute(select(User.username).where(User.id == me.user_id))).scalar_one()
    their_user = (await db.execute(select(User.username).where(User.id == other.user_id))).scalar_one()
    to_card = _card(other, their_user)
    from_card = _card(me, my_user)
    try:
        await ls.charge(db, pid, amount, "transfer_out", f"Sent to {other.display_name}" + (f": {note}" if note else ""),
                        ref=ref + ":out", meta={"to": to_card, "note": note})
    except ls.LifeError:
        raise WalletError("insufficient_funds")
    ls.credit(db, other.id, amount, "transfer_in", f"From {me.display_name}" + (f": {note}" if note else ""),
              ref=ref + ":in", meta={"from": from_card, "note": note})
    # paying someone is a friendly thing
    from app.services.social_service import get_rel

    for a, b in ((pid, other.id), (other.id, pid)):
        r = await get_rel(db, a, "player", b)
        r.friendship = min(100, r.friendship + 2)
    await db.commit()
    return {"id": key, "to": to_card, "from": from_card, "amount": amount, "note": note, "balance": await ls.balance(db, pid)}


async def history(db: AsyncSession, pid: str, limit: int = 40) -> list[dict[str, Any]]:
    rows = (
        await db.execute(
            select(GameLedgerEntry)
            .where(GameLedgerEntry.account_reference == f"player:{pid}", GameLedgerEntry.asset_type == "ksats")
            .order_by(GameLedgerEntry.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    out = []
    for r in rows:
        m = r.metadata_json or {}
        out.append({
            "id": r.id,
            "kind": r.entry_type,
            "amount": r.amount_minor_units,
            "description": r.description,
            "who": m.get("to") or m.get("from"),
            "note": m.get("note", ""),
            "at": r.created_at.isoformat() if r.created_at else None,
        })
    return out
