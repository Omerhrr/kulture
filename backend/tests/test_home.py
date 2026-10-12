"""Home furniture: starter layout once, buy/sell with real balance checks."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


async def _me(client, h):
    return (await client.get("/api/v1/players/me", headers=h)).json()


async def test_starter_layout_only_once_and_only_starter(client, auth_headers):
    bad = await client.post("/api/v1/home/init", json={"items": [{"sku": "generator", "x": 0, "z": 0}]}, headers=auth_headers)
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "not_starter_item"
    ok = await client.post("/api/v1/home/init", json={"items": [{"sku": "sofa3", "x": 1, "z": 2, "rot": 1}, {"sku": "bed_double", "x": -3, "z": -2}]}, headers=auth_headers)
    assert ok.status_code == 200 and len(ok.json()["items"]) == 2
    again = await client.post("/api/v1/home/init", json={"items": [{"sku": "sofa3", "x": 0, "z": 0}]}, headers=auth_headers)
    assert again.status_code == 409


async def test_move_buy_sell(client, auth_headers):
    await client.post("/api/v1/home/init", json={"items": [{"sku": "armchair", "x": 0, "z": 0}]}, headers=auth_headers)
    home = (await client.get("/api/v1/home", headers=auth_headers)).json()
    uid = home["items"][0]["uid"]
    assert (await client.put(f"/api/v1/home/items/{uid}", json={"x": 2.5, "z": -1, "rot": 3}, headers=auth_headers)).json()["rot"] == 3
    assert (await client.put(f"/api/v1/home/items/{uid}", json={"x": 50, "z": 0, "rot": 0}, headers=auth_headers)).status_code == 422

    start = (await _me(client, auth_headers))["ngn_balance_minor"]  # N25,000
    # too expensive for a new player
    assert (await client.post("/api/v1/home/buy", json={"sku": "tv_console"}, headers=auth_headers)).status_code == 409
    r = await client.post("/api/v1/home/buy", json={"sku": "snake_plant"}, headers=auth_headers)
    assert r.status_code == 200
    plant = r.json()["item"]["uid"]
    assert (await _me(client, auth_headers))["ngn_balance_minor"] == start - 8_000_00
    s = await client.post(f"/api/v1/home/items/{plant}/sell", headers=auth_headers)
    assert s.json()["refund_ngn_minor"] == 4_000_00
    assert (await _me(client, auth_headers))["ngn_balance_minor"] == start - 4_000_00
    # can't sell twice / someone else's
    assert (await client.post(f"/api/v1/home/items/{plant}/sell", headers=auth_headers)).status_code == 404
