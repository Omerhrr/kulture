"""Player stores: open a shop, stock it, price it; another player buys in
store or by delivery; the owner is paid less the levy; stock can't oversell."""

from __future__ import annotations

import asyncio
import uuid

from app.services import store_service as ss

# NOTE: asyncio_mode = auto (pytest.ini) collects the async tests.


async def _player(client):
    name = f"s_{uuid.uuid4().hex[:8]}"
    r = await client.post("/api/v1/auth/register", json={"username": name, "password": "suyaspice123", "display_name": name.title()})
    assert r.status_code == 201
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    pid = (await client.get("/api/v1/players/me", headers=h)).json()["id"]
    return h, pid


async def _fund(pid: str, amount: int):
    from app.db.session import AsyncSessionLocal
    from app.models.ledger import GameLedgerEntry

    async with AsyncSessionLocal() as db:
        db.add(GameLedgerEntry(account_reference=f"player:{pid}", asset_type="ksats", amount_minor_units=amount,
                               transaction_reference=f"test:{uuid.uuid4().hex}", entry_type="test", description="test"))
        await db.commit()


async def _bal(client, h):
    return (await client.get("/api/v1/wallet", headers=h)).json()["balance"]


async def _open_shop(client, h, pid):
    await _fund(pid, 60_000_000)
    assert (await client.post("/api/v1/life/rent", headers=h)).status_code == 200
    r = await client.post("/api/v1/life/business", json={"kind": "shop", "name": "Mama Put Provisions"}, headers=h)
    assert r.status_code == 200, r.text


async def test_store_lifecycle(client):
    owner, oid = await _player(client)
    buyer, bid = await _player(client)
    assert (await client.get("/api/v1/stores/mine", headers=owner)).status_code == 404
    await _open_shop(client, owner, oid)

    mine = (await client.get("/api/v1/stores/mine", headers=owner)).json()
    cat = {c["item"]: c for c in mine["catalog"]}
    assert "suya_spice" in cat and "quest_parcel" not in cat
    ws = cat["suya_spice"]["wholesale"]

    before = await _bal(client, owner)
    mine = (await client.post("/api/v1/stores/mine/restock", json={"item": "suya_spice", "qty": 5}, headers=owner)).json()
    assert await _bal(client, owner) == before - ws * 5
    line = next(x for x in mine["shelf"] if x["item"] == "suya_spice")
    assert line["stock"] == 5

    # price: inside the band only
    assert (await client.post("/api/v1/stores/mine/price", json={"item": "suya_spice", "price": ws * 10}, headers=owner)).status_code == 422
    price = ws * 2
    assert (await client.post("/api/v1/stores/mine/price", json={"item": "suya_spice", "price": price}, headers=owner)).status_code == 200

    # it shows in the directory and the store page
    d = (await client.get("/api/v1/stores", headers=buyer)).json()
    assert any(s["owner_id"] == oid and s["products"] == 1 for s in d)
    page = (await client.get(f"/api/v1/stores/{oid}", headers=buyer)).json()
    assert page["shelf"][0]["price"] == price

    # buy in store, then by delivery
    ob, bb = await _bal(client, owner), await _bal(client, buyer)
    r = await client.post(f"/api/v1/stores/{oid}/buy", json={"item": "suya_spice", "qty": 2, "idempotency_key": "b1"}, headers=buyer)
    assert r.status_code == 200, r.text
    assert await _bal(client, buyer) == bb - price * 2
    assert await _bal(client, owner) == ob + price * 2 - price * 2 * ss.LEVY_PCT // 100
    # the same tap again: no second charge
    r = await client.post(f"/api/v1/stores/{oid}/buy", json={"item": "suya_spice", "qty": 2, "idempotency_key": "b1"}, headers=buyer)
    assert r.json().get("repeat")
    assert await _bal(client, buyer) == bb - price * 2
    r = await client.post(f"/api/v1/stores/{oid}/buy", json={"item": "suya_spice", "qty": 1, "delivery": True}, headers=buyer)
    assert r.json()["fee"] == price * ss.DELIVERY_PCT // 100
    inv = (await client.get("/api/v1/players/me/inventory", headers=buyer)).json()
    assert any(i["code"] == "suya_spice" and i["quantity"] == 3 for i in inv["items"])

    # owner can't buy from themselves; sold-out refuses
    assert (await client.post(f"/api/v1/stores/{oid}/buy", json={"item": "suya_spice"}, headers=owner)).status_code == 409
    r = await client.post(f"/api/v1/stores/{oid}/buy", json={"item": "suya_spice", "qty": 5}, headers=buyer)
    assert r.status_code == 409 and "out_of_stock" in r.text

    # unshelve returns the rest to the bag
    mine = (await client.post("/api/v1/stores/mine/unshelve", json={"item": "suya_spice"}, headers=owner)).json()
    assert not mine["shelf"] and any(b["item"] == "suya_spice" and b["qty"] == 2 for b in mine["bag"])
    # and they can go back on from the bag
    mine = (await client.post("/api/v1/stores/mine/shelve", json={"item": "suya_spice", "qty": 2}, headers=owner)).json()
    assert mine["shelf"][0]["stock"] == 2 and not mine["bag"]


async def test_last_item_cannot_oversell(client):
    owner, oid = await _player(client)
    await _open_shop(client, owner, oid)
    await client.post("/api/v1/stores/mine/restock", json={"item": "kuli_kuli", "qty": 1}, headers=owner)
    buyers = [await _player(client) for _ in range(3)]
    rs = await asyncio.gather(*[client.post(f"/api/v1/stores/{oid}/buy", json={"item": "kuli_kuli"}, headers=h) for h, _ in buyers])
    assert sorted(r.status_code for r in rs) == [200, 409, 409], [r.text for r in rs]
    # the two who didn't get it weren't charged
    for (h, _), r in zip(buyers, rs):
        if r.status_code != 200:
            hist = (await client.get("/api/v1/wallet", headers=h)).json()["history"]
            assert not any(x["kind"] == "store_purchase" for x in hist)


async def test_restaurant_sells_food_only(client):
    owner, oid = await _player(client)
    await _fund(oid, 80_000_000)
    await client.post("/api/v1/life/rent", headers=owner)
    assert (await client.post("/api/v1/life/business", json={"kind": "restaurant", "name": "Suya Spot"}, headers=owner)).status_code == 200
    mine = (await client.get("/api/v1/stores/mine", headers=owner)).json()
    assert mine["catalog"] and all(c["type"] == "food" for c in mine["catalog"])
    r = await client.post("/api/v1/stores/mine/restock", json={"item": "power_bank", "qty": 1}, headers=owner)
    assert r.status_code == 409
