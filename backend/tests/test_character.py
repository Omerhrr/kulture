"""Characters: you choose the look and name; the game gives the life
(background, dream, neighbourhood + home) and starts you at home."""

from __future__ import annotations

import math
import uuid

from app.services import character_service as cs

# NOTE: asyncio_mode = auto (pytest.ini) collects the async tests.

LOOK = {"body": "woman", "skin": "#6e4630", "hair": "braids", "hairColor": "#141114", "topStyle": "tee", "top": "#e0a020",
        "bottomStyle": "skirt", "bottom": "#1d1c1f", "shoes": "sandals", "shoeColor": "#7a4a2a", "shape": {"cheekbones": 0.4}}


async def _player(client):
    name = f"c_{uuid.uuid4().hex[:8]}"
    r = await client.post("/api/v1/auth/register", json={"username": name, "password": "suyaspice123", "display_name": name.title()})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return h, r.json()["player_id"]


async def test_life_is_given_not_chosen(client):
    h, pid = await _player(client)
    assert (await client.get("/api/v1/character", headers=h)).status_code == 404
    bal0 = (await client.get("/api/v1/wallet", headers=h)).json()["balance"]
    # whatever the client asks for, the life is the game's
    r = await client.post("/api/v1/character", json={"name": "Zara", "look": {**LOOK, "evil": "x"}, "birth": "nepo", "dream": "sats"}, headers=h)
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["name"] == "Zara" and "evil" not in c["look"] and c["look"]["hair"] == "braids"
    assert (c["birth"], c["dream"], c["home"]["area"]) == cs._assign(pid)[:3]
    assert c["home"]["area"] in cs.BIRTHS[c["birth"]]["areas"]
    # the family's gift, once
    assert (await client.get("/api/v1/wallet", headers=h)).json()["balance"] == bal0 + cs.BIRTHS[c["birth"]]["cash"]
    # made once; then only look / name change
    assert (await client.post("/api/v1/character", json={"name": "Again", "look": LOOK}, headers=h)).status_code == 409
    c2 = (await client.patch("/api/v1/character", json={"name": "Zara B", "look": {**LOOK, "hair": "afro"}}, headers=h)).json()
    assert c2["name"] == "Zara B" and c2["look"]["hair"] == "afro" and c2["birth"] == c["birth"] and c2["home"] == c["home"]
    # and you start at home
    me = (await client.get("/api/v1/players/me", headers=h)).json()
    assert math.hypot(me["position"][0] - c["home"]["x"], me["position"][2] - c["home"]["z"]) < 1


async def test_backgrounds_and_homes_spread(client):
    seen = {cs._assign(uuid.uuid4().hex)[0] for _ in range(300)}
    assert seen == set(cs.BIRTHS)
    homes = {cs._assign(uuid.uuid4().hex)[2] for _ in range(300)}
    assert len(homes) >= 10  # people live all over the city


async def test_arrive_home_only_near_your_home(client):
    from app.db.session import AsyncSessionLocal

    h, pid = await _player(client)
    c = (await client.post("/api/v1/character", json={"name": "Kabir", "look": {}}, headers=h)).json()
    hx, hz = c["home"]["x"], c["home"]["z"]
    async with AsyncSessionLocal() as db:
        assert await cs.arrive_home(db, pid, hx + 40, hz - 30) == (hx + 40, hz - 30)
        try:
            await cs.arrive_home(db, pid, hx + 900, hz)
            raise AssertionError("teleported across town")
        except cs.CharacterError as e:
            assert str(e) == "not_your_home"


async def test_commute_home_goes_to_your_own_home(client):
    from app.db.session import AsyncSessionLocal
    from app.services.shift_service import commute_destination

    h, pid = await _player(client)
    c = (await client.post("/api/v1/character", json={"name": "Hadiza", "look": {}}, headers=h)).json()
    hx, hz = c["home"]["x"], c["home"]["z"]
    async with AsyncSessionLocal() as db:
        assert await commute_destination(db, "home", [hx + 20, hz], pid) == (hx + 20, hz)
        assert await commute_destination(db, "home", [hx + 2000, hz], pid) is None


async def test_legacy_sim_keeps_its_life(client):
    h, _ = await _player(client)
    c = (await client.post("/api/v1/character", json={"name": "Old", "look": {}, "legacy": {"birth": "nepo", "dream": "trader"}}, headers=h)).json()
    assert c["birth"] == "nepo" and c["dream"] == "trader" and c["home"]["area"] in cs.BIRTHS["nepo"]["areas"]
