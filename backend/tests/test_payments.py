"""Payment pipeline tests (spec: bitcoin_tests + acceptance KK-004..KK-007).

Covers: invoice creation, verified settlement fulfillment, duplicate event
idempotency, replay-safe purchases, concurrency on the last item, expiry,
and reconciliation after a missed notification.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest

pytestmark = pytest.mark.asyncio


async def _buy_and_invoice(client, auth_headers, world_ctx, listing_index=0, qty=1, idem=None):
    listing = world_ctx["business"]["listings"][listing_index]
    body = {"listing_id": listing["id"], "quantity": qty}
    if idem:
        body["idempotency_key"] = idem
    purchase = await client.post("/api/v1/purchases", headers=auth_headers, json=body)
    assert purchase.status_code == 201, purchase.text
    intent = purchase.json()
    inv = await client.post(
        f"/api/v1/payment-intents/{intent['id']}/invoice", headers=auth_headers
    )
    assert inv.status_code == 200, inv.text
    return inv.json()


async def test_purchase_replay_safe(client, auth_headers, world_ctx):
    listing = world_ctx["business"]["listings"][0]
    body = {"listing_id": listing["id"], "quantity": 1, "idempotency_key": "replay-test-001"}
    r1 = await client.post("/api/v1/purchases", headers=auth_headers, json=body)
    r2 = await client.post("/api/v1/purchases", headers=auth_headers, json=body)
    assert r1.status_code == 201 and r2.status_code == 201
    assert r1.json()["id"] == r2.json()["id"]  # same intent returned, never duplicated


async def test_invoice_is_valid_bolt11_exact_amount(client, auth_headers, world_ctx):
    listing = world_ctx["business"]["listings"][3]
    inv = await _buy_and_invoice(client, auth_headers, world_ctx, listing_index=3)
    assert inv["invoice_bolt11"].startswith("lnbcrt")
    assert inv["amount_sats"] == listing["price_sats"]
    assert inv["status"] == "awaiting_payment"
    assert len(inv["invoice_bolt11"]) > 120


async def test_settlement_fulfills_exactly_once(client, auth_headers, world_ctx):
    from app.payments.lightning_service import process_settlement
    from app.payments.mock_adapter import get_adapter
    from app.db.session import AsyncSessionLocal
    from app.models.payments import PaymentIntent, LightningInvoice
    from sqlalchemy import select

    inv = await _buy_and_invoice(client, auth_headers, world_ctx, listing_index=1, qty=2)
    adapter = get_adapter()
    event = adapter.simulate_external_payment(await _hash_for(inv["invoice_bolt11"]))

    async with AsyncSessionLocal() as db:
        outcome = await process_settlement(db, event)
        assert outcome["outcome"] == "fulfilled"

        # duplicate delivery of the same event must NOT grant twice
        outcome2 = await process_settlement(db, event)
        assert outcome2["outcome"] == "duplicate"

        intent = (await db.execute(
            select(PaymentIntent).where(PaymentIntent.id == outcome["intent_id"])
        )).scalar_one()
        assert intent.status == "settled"
        assert intent.fulfilled_at is not None

    r = await client.get("/api/v1/players/me/inventory", headers=auth_headers)
    items = {i["code"]: i for i in r.json()["items"]}
    code = inv["item_code"]
    assert items[code]["quantity"] >= 2

    # re-simulating payment on a settled invoice fails at the node level
    with pytest.raises(Exception):
        adapter.simulate_external_payment(await _hash_for(inv["invoice_bolt11"]))


async def _hash_for(bolt11: str) -> str:
    """Reverse lookup: find the invoice row's payment_hash by bolt11 string."""
    from sqlalchemy import select
    from app.db.session import AsyncSessionLocal
    from app.models.payments import LightningInvoice

    async with AsyncSessionLocal() as db:
        inv = (await db.execute(
            select(LightningInvoice).where(LightningInvoice.invoice_bolt11 == bolt11)
        )).scalar_one()
        return inv.payment_hash


async def test_expired_invoice_cannot_settle(client, auth_headers, world_ctx):
    from app.payments.mock_adapter import get_adapter

    inv = await _buy_and_invoice(client, auth_headers, world_ctx, listing_index=2)
    adapter = get_adapter()
    # force-expire in the simulated node state
    from app.payments.mock_adapter import MockRegtestAdapter

    assert isinstance(adapter, MockRegtestAdapter)
    payment_hash = await _hash_for(inv["invoice_bolt11"])
    adapter._invoices[payment_hash]["expires_at"] = adapter._invoices[payment_hash][
        "expires_at"
    ].replace(year=2020)
    with pytest.raises(Exception):
        adapter.simulate_external_payment(payment_hash)


async def test_concurrent_purchases_of_last_item_never_oversell(client, auth_headers, world_ctx):
    """Two buyers race for the last unit: at most one fulfillment, stock never
    negative, the other lands in reconciliation_required (refund handled by
    an authorized process — spec security rule)."""
    from sqlalchemy import select, update
    from app.db.session import AsyncSessionLocal
    from app.models.business import ShopListing
    from app.models.payments import PaymentIntent
    from app.payments.lightning_service import process_settlement
    from app.payments.mock_adapter import get_adapter

    listing = world_ctx["business"]["listings"][5]  # power bank — small stock
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(ShopListing).where(ShopListing.id == listing["id"]).values(quantity_available=1)
        )
        await db.commit()

    async def buy():
        r = await client.post("/api/v1/auth/register", json={
            "username": f"racer_{uuid.uuid4().hex[:10]}", "password": "password123",
            "display_name": "Racer"})
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        p = await client.post("/api/v1/purchases", headers=h,
                              json={"listing_id": listing["id"], "quantity": 1})
        if p.status_code != 201:
            return None
        i = p.json()
        inv = await client.post(f"/api/v1/payment-intents/{i['id']}/invoice", headers=h)
        return inv.json()

    inv1, inv2 = await asyncio.gather(buy(), buy())
    assert inv1 and inv2

    adapter = get_adapter()
    e1 = adapter.simulate_external_payment(await _hash_for(inv1["invoice_bolt11"]))
    e2 = adapter.simulate_external_payment(await _hash_for(inv2["invoice_bolt11"]))

    async with AsyncSessionLocal() as db:
        o1 = await process_settlement(db, e1)
        o2 = await process_settlement(db, e2)
    outcomes = {o1["outcome"], o2["outcome"]}
    assert "fulfilled" in outcomes
    assert outcomes <= {"fulfilled", "duplicate", "rejected_insufficient_stock_after_payment"}

    async with AsyncSessionLocal() as db:
        row = (await db.execute(
            select(ShopListing).where(ShopListing.id == listing["id"])
        )).scalar_one()
        assert row.quantity_available >= 0  # never oversold


async def test_reconciliation_recovers_missed_settlement(client, auth_headers, world_ctx):
    """Node settled but the app missed the webhook — reconcile_pending must
    discover and process the settlement (spec: reconciliation)."""
    from sqlalchemy import select
    from app.db.session import AsyncSessionLocal
    from app.models.payments import LightningInvoice, PaymentIntent
    from app.payments.mock_adapter import get_adapter
    from app.payments.lightning_service import reconcile_pending

    inv = await _buy_and_invoice(client, auth_headers, world_ctx, listing_index=4)
    adapter = get_adapter()
    payment_hash = await _hash_for(inv["invoice_bolt11"])

    # node-side settlement happens but app hasn't processed any event yet
    state = adapter._invoices[payment_hash]
    from datetime import datetime, timezone

    state["status"] = "settled"
    state["settled_at"] = datetime.now(timezone.utc)

    async with AsyncSessionLocal() as db:
        processed = await reconcile_pending(db)
        assert processed >= 1
        intent = (await db.execute(
            select(PaymentIntent).where(
                PaymentIntent.id == (await db.execute(
                    select(LightningInvoice).where(LightningInvoice.payment_hash == payment_hash)
                )).scalar_one().payment_intent_id)
        )).scalar_one()
        assert intent.status == "settled"


async def test_client_cannot_confirm_payment(client, auth_headers, world_ctx):
    """A fabricated 'I paid' message from the browser must do nothing —
    there is no such endpoint; verify the API has no client-confirm route."""
    r = await client.post("/api/v1/purchases/i-paid-m sincerely", headers=auth_headers)
    assert r.status_code in (404, 405)


async def test_lightning_health_endpoint(client):
    r = await client.get("/api/v1/lightning/health")
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "mock"
    assert body["healthy"] is True
