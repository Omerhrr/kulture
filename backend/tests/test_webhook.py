"""P1 hardening: authenticated real-node settlement webhook.

Transport authentication = bearer token + HMAC-SHA256("{ts}.{raw_body}") +
timestamp tolerance window. The event then flows through the SAME idempotent
settlement pipeline as any other source (independent adapter verification,
unique provider_event_id, exactly-once fulfillment) — so even a validly
signed replay can never deliver items twice.
"""

from __future__ import annotations

import hmac
import hashlib
import json
import time
import uuid

import pytest

pytestmark = pytest.mark.asyncio

BEARER = "wh-bearer-test"
SECRET = "wh-secret-test"


def _sign(body: bytes, ts: int | None = None) -> dict[str, str]:
    ts = ts if ts is not None else int(time.time())
    sig = hmac.new(SECRET.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return {
        "Authorization": f"Bearer {BEARER}",
        "X-KK-Timestamp": str(ts),
        "X-KK-Signature": sig,
    }


def _event_body(payment_hash: str, amount_sats: int, event_id: str | None = None) -> bytes:
    return json.dumps(
        {
            "provider": "ldk_node",
            "provider_event_id": event_id or f"evt-{uuid.uuid4().hex[:12]}",
            "payment_hash": payment_hash,
            "amount_paid_sats": amount_sats,
            "settled_at": int(time.time()),
        }
    ).encode()


async def test_webhook_disabled_without_secrets(client):
    """Unconfigured servers must not expose the endpoint at all."""
    r = await client.post("/api/v1/payments/webhook", content=b"{}")
    assert r.status_code == 503, r.text
    assert r.json()["detail"]["code"] == "webhook_disabled"


async def test_webhook_rejects_bad_credentials(client, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "webhook_bearer_token", BEARER)
    monkeypatch.setattr(settings, "webhook_signature_secret", SECRET)

    # no headers at all
    r = await client.post("/api/v1/payments/webhook", content=b"{}")
    assert r.status_code == 401, r.text

    body = _event_body("deadbeef", 100)

    # wrong bearer
    h = _sign(body)
    h["Authorization"] = "Bearer not-the-token"
    r = await client.post("/api/v1/payments/webhook", content=body, headers=h)
    assert r.status_code == 401, r.text

    # stale timestamp (outside tolerance window)
    h = _sign(body, ts=int(time.time()) - 3600)
    r = await client.post("/api/v1/payments/webhook", content=body, headers=h)
    assert r.status_code == 401, r.text

    # tampered payload (signature computed over different bytes)
    h = _sign(b'{"tampered": true}')
    r = await client.post("/api/v1/payments/webhook", content=body, headers=h)
    assert r.status_code == 401, r.text

    # missing signature
    h = _sign(body)
    h.pop("X-KK-Signature")
    r = await client.post("/api/v1/payments/webhook", content=body, headers=h)
    assert r.status_code == 401, r.text

    # malformed JSON with a VALID signature → 400, not 500
    good_body = b"{not json"
    h = _sign(good_body)
    r = await client.post("/api/v1/payments/webhook", content=good_body, headers=h)
    assert r.status_code == 400, r.text


async def test_webhook_settles_exactly_once(client, auth_headers, world_ctx, monkeypatch):
    from app.core.config import settings
    from app.payments.mock_adapter import get_adapter
    from test_payments import _buy_and_invoice, _hash_for

    monkeypatch.setattr(settings, "webhook_bearer_token", BEARER)
    monkeypatch.setattr(settings, "webhook_signature_secret", SECRET)

    inv = await _buy_and_invoice(client, auth_headers, world_ctx, listing_index=1, qty=1)
    payment_hash = await _hash_for(inv["invoice_bolt11"])

    # the external wallet pays the REAL node first — the node's own state now
    # knows the invoice is settled (that's what makes independent verification
    # pass: the webhook alone is never the source of truth)
    adapter = get_adapter()
    adapter.simulate_external_payment(payment_hash)

    body = _event_body(payment_hash, inv["amount_sats"])
    r = await client.post("/api/v1/payments/webhook", content=body, headers=_sign(body))
    assert r.status_code == 200, r.text
    assert r.json()["outcome"] == "fulfilled"

    # replayed notification (same provider_event_id) → duplicate, never twice
    r2 = await client.post("/api/v1/payments/webhook", content=body, headers=_sign(body))
    assert r2.status_code == 200, r2.text
    assert r2.json()["outcome"] == "duplicate"

    # the item was granted exactly once
    r3 = await client.get("/api/v1/players/me/inventory", headers=auth_headers)
    items = {i["code"]: i for i in r3.json()["items"]}
    assert items[inv["item_code"]]["quantity"] >= 1

    # a webhook for an unknown payment hash is acknowledged but rejected —
    # the reconciliation worker owns the follow-up, webhooks stay idempotent
    body4 = _event_body("f" * 64, 999)
    r4 = await client.post("/api/v1/payments/webhook", content=body4, headers=_sign(body4))
    assert r4.status_code == 200, r4.text
    assert r4.json()["outcome"] == "rejected_unknown_payment_hash"
