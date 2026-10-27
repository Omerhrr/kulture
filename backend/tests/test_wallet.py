"""Sending k-sats between players: exact debit/credit, idempotent retries,
limits, no overdraft, and the history both sides see."""

from __future__ import annotations

import asyncio
import uuid

# NOTE: asyncio_mode = auto (pytest.ini) collects the async tests.


async def _player(client) -> tuple[dict, str]:
    name = f"w_{uuid.uuid4().hex[:8]}"
    r = await client.post("/api/v1/auth/register", json={"username": name, "password": "suyaspice123", "display_name": name.title()})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, name


async def _bal(client, h) -> int:
    return (await client.get("/api/v1/wallet", headers=h)).json()["balance"]


async def test_send_money_between_players(client):
    a, an = await _player(client)
    b, bn = await _player(client)
    a0, b0 = await _bal(client, a), await _bal(client, b)

    # find them by part of their username
    found = (await client.get(f"/api/v1/wallet/people?q={bn[2:7]}", headers=a)).json()
    assert any(p["username"] == bn for p in found)
    assert not any(p["username"] == an for p in found)

    r = await client.post("/api/v1/wallet/send", json={"to": "@" + bn, "amount": 250_000, "note": "for the suya", "idempotency_key": "k1"}, headers=a)
    assert r.status_code == 200, r.text
    assert await _bal(client, a) == a0 - 250_000
    assert await _bal(client, b) == b0 + 250_000

    # a retry with the same key pays once
    r2 = await client.post("/api/v1/wallet/send", json={"to": "@" + bn, "amount": 250_000, "idempotency_key": "k1"}, headers=a)
    assert r2.status_code == 200 and r2.json()["repeat"]
    assert await _bal(client, a) == a0 - 250_000

    # by player id too (what the app sends after a search)
    bid = next(p["id"] for p in found if p["username"] == bn)
    r3 = await client.post("/api/v1/wallet/send", json={"to": bid, "amount": 10_000}, headers=a)
    assert r3.status_code == 200, r3.text
    assert await _bal(client, b) == b0 + 260_000

    hb = (await client.get("/api/v1/wallet", headers=b)).json()["history"]
    got = next(x for x in hb if x["kind"] == "transfer_in" and x["amount"] == 250_000)
    assert got["amount"] == 250_000 and got["who"]["username"] == an and got["note"] == "for the suya"
    ha = (await client.get("/api/v1/wallet", headers=a)).json()["history"]
    assert next(x for x in ha if x["kind"] == "transfer_out")["who"]["username"] == bn


async def test_send_money_refusals(client):
    a, an = await _player(client)
    b, bn = await _player(client)
    bal = await _bal(client, a)
    for body, code in (
        ({"to": bn, "amount": 0}, 422),
        ({"to": bn, "amount": 999}, 422),
        ({"to": bn, "amount": 10_000_001}, 422),
        ({"to": "nobody_" + uuid.uuid4().hex[:6], "amount": 5_000}, 404),
        ({"to": an, "amount": 5_000}, 404),  # yourself
    ):
        r = await client.post("/api/v1/wallet/send", json=body, headers=a)
        assert r.status_code == code, (body, r.text)
    assert await _bal(client, a) == bal


async def test_no_overdraft_under_double_tap(client):
    a, _ = await _player(client)
    b, bn = await _player(client)
    bal = await _bal(client, a)
    amount = min(10_000_000, bal // 2 + 1)  # two of these can't both fit
    rs = await asyncio.gather(*[
        client.post("/api/v1/wallet/send", json={"to": bn, "amount": amount, "idempotency_key": f"t{i}"}, headers=a) for i in range(2)
    ])
    ok = [r for r in rs if r.status_code == 200]
    assert len(ok) == 1, [r.text for r in rs]
    assert await _bal(client, a) == bal - amount
