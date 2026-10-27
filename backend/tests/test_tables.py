"""Open tables: a player opens a public table, another sees it in the lobby
and sits down; a table can start early with bots."""

from __future__ import annotations

import uuid

# NOTE: asyncio_mode = auto (pytest.ini) collects the async tests.


async def _player(client):
    name = f"g_{uuid.uuid4().hex[:8]}"
    r = await client.post("/api/v1/auth/register", json={"username": name, "password": "suyaspice123", "display_name": name.title()})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def test_two_players_meet_at_an_open_table(client):
    a, b = await _player(client), await _player(client)
    m = (await client.post("/api/v1/games/join", json={"game": "ayo"}, headers=a)).json()
    assert m["status"] == "waiting"
    tables = (await client.get("/api/v1/games/tables", headers=b)).json()["tables"]
    t = next(t for t in tables if t["id"] == m["id"])
    assert t["game"] == "ayo" and len(t["players"]) == 1 and t["bots_in"] > 0
    j = (await client.post("/api/v1/games/join", json={"game": "ayo", "match_id": m["id"]}, headers=b)).json()
    assert j["id"] == m["id"] and j["status"] == "playing"  # ayo seats 2: full, starts
    assert not any(p.get("bot") for p in j["players"])
    # no longer listed, and can't be joined twice
    assert m["id"] not in {t["id"] for t in (await client.get("/api/v1/games/tables", headers=b)).json()["tables"]}
    c = await _player(client)
    assert (await client.post("/api/v1/games/join", json={"game": "ayo", "match_id": m["id"]}, headers=c)).status_code == 404


async def test_start_now_with_bots(client):
    a, b = await _player(client), await _player(client)
    m = (await client.post("/api/v1/games/join", json={"game": "ludo"}, headers=a)).json()
    assert (await client.post(f"/api/v1/games/match/{m['id']}/start", headers=b)).status_code == 404  # not at the table
    s = (await client.post(f"/api/v1/games/match/{m['id']}/start", headers=a)).json()
    assert s["status"] == "playing" and any(p.get("bot") for p in s["players"])
