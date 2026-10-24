"""k-sats deposits: verified sats credit k-sats exactly once (1 sat = 1,000)."""

import pytest

from tests.test_payments import _hash_for

pytestmark = pytest.mark.asyncio


async def _balance(client, h) -> int:
    r = await client.get("/api/v1/players/me", headers=h)
    return r.json()["ksats_balance"]


async def test_deposit_credits_exactly_once(client, auth_headers):
    from app.db.session import AsyncSessionLocal
    from app.payments.lightning_service import SATS_TO_KSATS, process_settlement
    from app.payments.mock_adapter import get_adapter

    before = await _balance(client, auth_headers)
    r = await client.post("/api/v1/deposits", headers=auth_headers, json={"sats": 250})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["ksats_credits"] == 250 * SATS_TO_KSATS
    bolt = body["intent"]["invoice_bolt11"]
    assert bolt and body["intent"]["amount_sats"] == 250
    # nothing credited before payment
    assert await _balance(client, auth_headers) == before

    event = get_adapter().simulate_external_payment(await _hash_for(bolt))
    async with AsyncSessionLocal() as db:
        assert (await process_settlement(db, event))["outcome"] == "fulfilled"
        assert (await process_settlement(db, event))["outcome"] == "duplicate"
    assert await _balance(client, auth_headers) == before + 250 * SATS_TO_KSATS


@pytest.mark.parametrize("sats", [0, -5, 5_000_001])
async def test_deposit_rejects_bad_amounts(client, auth_headers, sats):
    r = await client.post("/api/v1/deposits", headers=auth_headers, json={"sats": sats})
    assert r.status_code == 422


async def test_deposit_invoice_refetch_is_stable(client, auth_headers):
    r = await client.post("/api/v1/deposits", headers=auth_headers, json={"sats": 1000})
    intent = r.json()["intent"]
    r2 = await client.post(f"/api/v1/payment-intents/{intent['id']}/invoice", headers=auth_headers)
    assert r2.status_code in (200, 201), r2.text
    assert r2.json()["invoice_bolt11"] == intent["invoice_bolt11"]
