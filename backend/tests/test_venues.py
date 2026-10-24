"""Venue services: server-priced, debited from the real balance."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


async def test_spend_and_unknown(client, auth_headers):
    svc = (await client.get("/api/v1/venues/services")).json()["services"]
    assert any(s["id"] == "bar_drink" for s in svc)
    start = (await client.get("/api/v1/players/me", headers=auth_headers)).json()["ksats_balance"]
    r = await client.post("/api/v1/venues/spend", json={"service": "bar_drink"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["balance_ksats"] == start - 150_000
    bad = await client.post("/api/v1/venues/spend", json={"service": "free_money"}, headers=auth_headers)
    assert bad.status_code == 404


async def test_cannot_overspend(client, auth_headers):
    for _ in range(40):
        r = await client.post("/api/v1/venues/spend", json={"service": "hotel_night"}, headers=auth_headers)
        if r.status_code == 409:
            assert r.json()["detail"]["code"] == "insufficient_funds"
            return
    raise AssertionError("never ran out of money")
