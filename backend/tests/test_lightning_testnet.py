"""Testnet adapters (LND REST, LNbits) against fake nodes: invoices must be
for the configured test network and the exact amount; settlement is read
back from the node; mainnet is refused everywhere."""

from __future__ import annotations

import base64
import json
import os
import time

import httpx
import pytest

from app.core.config import settings
from app.payments import bolt11
from app.payments.interfaces import InvoiceRequest, LightningAdapterError
from app.payments.mock_adapter import build_bolt11

# NOTE: asyncio_mode = auto (pytest.ini) collects the async tests.

HASH = "ab" * 32


def _inv(hrp: str, sats: int) -> str:
    return build_bolt11(sats, bytes.fromhex(HASH), "test", 600, int(time.time()), hrp=hrp)


def test_bolt11_network_and_amount():
    assert bolt11.network_of(_inv("lntb", 1500)) == "testnet"
    assert bolt11.network_of(_inv("lntbs", 1500)) == "signet"
    assert bolt11.network_of(_inv("lnbcrt", 1500)) == "regtest"
    assert bolt11.network_of(_inv("lnbc", 1500)) == "mainnet"
    for sats in (1, 800, 1500, 9000, 21_000, 100_000, 2_500_000):
        assert bolt11.amount_sats_of(_inv("lntb", sats)) == sats
    assert bolt11.amount_sats_of("lntb1pxyz") is None
    bolt11.check_invoice(_inv("lntb", 1500), "testnet", 1500)
    with pytest.raises(LightningAdapterError, match="wrong_network_mainnet"):
        bolt11.check_invoice(_inv("lnbc", 1500), "testnet", 1500)
    with pytest.raises(LightningAdapterError, match="amount_mismatch"):
        bolt11.check_invoice(_inv("lntb", 1499), "testnet", 1500)
    with pytest.raises(LightningAdapterError, match="mainnet_disabled"):
        bolt11.check_invoice(_inv("lnbc", 1500), "mainnet", 1500)


@pytest.fixture
def lnconf(monkeypatch):
    def apply(**kw):
        for k, v in kw.items():
            monkeypatch.setattr(settings, k, v)
    apply(lightning_network="testnet")
    return apply


def _lnd_node(hrp="lntb", network="testnet", settled=False, value=None):
    calls = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(req)
        assert req.headers["grpc-metadata-macaroon"] == "abcd"
        if req.url.path == "/v1/getinfo":
            return httpx.Response(200, json={"chains": [{"chain": "bitcoin", "network": network}], "synced_to_chain": True, "num_active_channels": 2, "alias": "kk-testnet"})
        if req.url.path == "/v1/invoices":
            b = json.loads(req.content)
            amt = int(value if value is not None else b["value"])
            return httpx.Response(200, json={"r_hash": base64.b64encode(bytes.fromhex(HASH)).decode(), "payment_request": _inv(hrp, amt), "add_index": "7"})
        if req.url.path == f"/v1/invoice/{HASH}":
            return httpx.Response(200, json={"state": "SETTLED" if settled else "OPEN", "value": "1500", "amt_paid_sat": "1500" if settled else "0", "settle_date": str(int(time.time())) if settled else "0", "creation_date": str(int(time.time())), "expiry": "600", "payment_request": _inv(hrp, 1500)})
        return httpx.Response(404, json={})

    return httpx.MockTransport(handler), calls


async def test_lnd_testnet_invoice_and_settlement(lnconf):
    from app.payments.lnd_adapter import LndRestAdapter

    lnconf(lnd_rest_url="https://node.test:8080", lnd_macaroon_hex="abcd")
    t, calls = _lnd_node()
    a = LndRestAdapter(transport=t)
    inv = await a.create_invoice(InvoiceRequest(amount_sats=1500, memo="suya", expiry_seconds=600, payment_hash="00" * 32))
    assert inv.bolt11.startswith("lntb15u") and inv.payment_hash == HASH  # the node's hash, not ours
    assert (await a.get_invoice_status(HASH)).status == "awaiting_payment"
    assert await a.reconcile_pending_invoices([HASH]) == []
    t2, _ = _lnd_node(settled=True)
    a2 = LndRestAdapter(transport=t2)
    evs = await a2.reconcile_pending_invoices([HASH])
    assert len(evs) == 1 and evs[0].amount_paid_sats == 1500
    assert await a2.validate_settlement_event(evs[0])
    h = await a2.get_node_health()
    assert h["ready"] and h["network"] == "testnet"


async def test_lnd_refuses_mainnet_node_and_bad_invoices(lnconf):
    from app.payments.lnd_adapter import LndRestAdapter

    lnconf(lnd_rest_url="https://node.test:8080", lnd_macaroon_hex="abcd")
    # a mainnet node: refused before any invoice is made
    t, calls = _lnd_node(network="mainnet")
    with pytest.raises(LightningAdapterError, match="node_network_mismatch"):
        await LndRestAdapter(transport=t).create_invoice(InvoiceRequest(1500, "x", 600, "00" * 32))
    assert not any(c.url.path == "/v1/invoices" for c in calls)
    # a node that answers with a mainnet invoice / the wrong amount
    t, _ = _lnd_node(hrp="lnbc")
    with pytest.raises(LightningAdapterError, match="wrong_network"):
        await LndRestAdapter(transport=t).create_invoice(InvoiceRequest(1500, "x", 600, "00" * 32))
    t, _ = _lnd_node(value=1)
    with pytest.raises(LightningAdapterError, match="amount_mismatch"):
        await LndRestAdapter(transport=t).create_invoice(InvoiceRequest(1500, "x", 600, "00" * 32))
    # mainnet configured: the adapter won't even start
    lnconf(lightning_network="mainnet")
    with pytest.raises(LightningAdapterError, match="mainnet_disabled"):
        LndRestAdapter(transport=t)


def _lnbits(hrp="lntb", paid=False):
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.headers["x-api-key"] == "invkey"
        if req.method == "POST" and req.url.path == "/api/v1/payments":
            b = json.loads(req.content)
            assert b["out"] is False
            return httpx.Response(201, json={"payment_hash": HASH, "bolt11": _inv(hrp, b["amount"]), "checking_id": HASH})
        if req.url.path == f"/api/v1/payments/{HASH}":
            return httpx.Response(200, json={"paid": paid, "details": {"amount": 1500_000, "time": int(time.time()), "bolt11": _inv(hrp, 1500), "status": "success" if paid else "pending"}})
        if req.url.path == "/api/v1/wallet":
            return httpx.Response(200, json={"name": "kk", "balance": 0})
        return httpx.Response(404, json={})

    return httpx.MockTransport(handler)


async def test_lnbits_testnet(lnconf):
    from app.payments.lnbits_adapter import LnbitsAdapter

    lnconf(lnbits_url="https://lnbits.test", lnbits_invoice_key="invkey")
    a = LnbitsAdapter(transport=_lnbits())
    inv = await a.create_invoice(InvoiceRequest(1500, "suya", 600, "00" * 32))
    assert inv.bolt11.startswith("lntb") and inv.payment_hash == HASH
    assert await a.reconcile_pending_invoices([HASH]) == []
    evs = await LnbitsAdapter(transport=_lnbits(paid=True)).reconcile_pending_invoices([HASH])
    assert evs and evs[0].amount_paid_sats == 1500
    with pytest.raises(LightningAdapterError, match="wrong_network_mainnet"):
        await LnbitsAdapter(transport=_lnbits(hrp="lnbc")).create_invoice(InvoiceRequest(1500, "x", 600, "00" * 32))
    assert (await a.get_node_health())["ready"]


def test_unconfigured_node_is_reported_not_mocked(monkeypatch):
    from app.payments import mock_adapter

    monkeypatch.setattr(settings, "lightning_provider", "lnbits")
    monkeypatch.setattr(settings, "lnbits_url", "")
    mock_adapter.reset_adapter()
    try:
        a = mock_adapter.get_adapter()
        assert isinstance(a, mock_adapter.UnavailableAdapter) and a.reason == "lnbits_not_configured"
    finally:
        mock_adapter.reset_adapter()


def test_production_refuses_mock():
    from app.core.config import Settings

    with pytest.raises(ValueError, match="tests only"):
        Settings(env="production", jwt_secret="x" * 40, database_url="postgresql+asyncpg://u:p@h/db", lightning_provider="mock")
    assert os.environ["KK_LIGHTNING_PROVIDER"] == "mock"  # CI only
