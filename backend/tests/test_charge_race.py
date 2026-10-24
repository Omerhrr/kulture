"""Ledger money-safety: simultaneous charges on one account (double-tap,
two tabs, two requests) must never draw a balance below zero."""

from __future__ import annotations

import asyncio
import uuid

import pytest

pytestmark = pytest.mark.asyncio

from app.services.player_service import STARTING_KSATS

BIG = 100_000_000  # exactly one nice car, in kobo


async def _fresh_player_with(balance: int) -> str:
    from app.db.session import AsyncSessionLocal
    from app.services import life_service, player_service

    async with AsyncSessionLocal() as db:
        tok = await player_service.register_player(
            db, f"m_{uuid.uuid4().hex[:10]}", "suyaspice123", "Money Runner"
        )
        player_id = tok.player_id
        life_service.credit(db, player_id, balance, "test_seed", "test money")
        await db.commit()
    return player_id


async def test_concurrent_charges_never_overdraw(client):
    player_id = await _fresh_player_with(BIG)

    async def attempt() -> None:
        from app.db.session import AsyncSessionLocal
        from app.services import life_service

        async with AsyncSessionLocal() as db:
            # the purchase (e.g. a rental deposit) commits on its own
            await life_service.charge(db, player_id, BIG, "test_purchase", "big buy")
            await db.commit()

    # three tabs race for the same single purchase
    results = await asyncio.gather(*(attempt() for _ in range(3)), return_exceptions=True)
    paid = sum(1 for r in results if not isinstance(r, BaseException))

    from app.db.session import AsyncSessionLocal
    from app.services import life_service

    async with AsyncSessionLocal() as db:
        final = await life_service.balance(db, player_id)

    # every failed charge must say why
    for r in results:
        if isinstance(r, BaseException):
            assert "insufficient_funds" in str(type(r).__module__ + type(r).__name__ + str(r)), r
    assert paid == 1
    # starting grant (2,500,000 ks) stays; exactly one purchase drew the account
    assert final == STARTING_KSATS and final >= 0


async def test_sequential_charges_still_work(client):
    player_id = await _fresh_player_with(30_000_00)
    from app.db.session import AsyncSessionLocal
    from app.services import life_service

    async with AsyncSessionLocal() as db:
        await life_service.charge(db, player_id, 10_000_00, "test_purchase", "one")
        await life_service.charge(db, player_id, 10_000_00, "test_purchase", "two")
        await db.commit()
        assert await life_service.balance(db, player_id) == STARTING_KSATS + 30_000_00 - 20_000_00
        with pytest.raises(life_service.LifeError):
            await life_service.charge(db, player_id, 40_000_00, "test_purchase", "more than remains")
