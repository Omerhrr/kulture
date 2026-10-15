"""Life progression, social, phone games and races."""

from __future__ import annotations

import uuid

import pytest

from app.services.life_service import QUESTIONS

pytestmark = pytest.mark.asyncio


async def _new(client):
    r = await client.post("/api/v1/auth/register", json={"username": f"u_{uuid.uuid4().hex[:8]}", "password": "suyaspice123", "display_name": "Other"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()


async def _session(client, h, kind):
    s = await client.post("/api/v1/life/session", json={"kind": kind}, headers=h)
    assert s.status_code == 200, s.text
    ans = {q["id"]: QUESTIONS[q["id"]][3] for q in s.json()["questions"]}
    r = await client.post("/api/v1/life/session/submit", json={"answers": ans}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


async def test_school_to_career(client, auth_headers):
    st = (await client.get("/api/v1/life/status", headers=auth_headers)).json()
    assert st["housing"] == "family" and st["enrollment"] is None
    r = await client.post("/api/v1/life/enroll", json={"school": "kadpoly", "course": "computer_science"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    early = await client.post("/api/v1/life/session", json={"kind": "exam"}, headers=auth_headers)
    assert early.status_code == 409
    for _ in range(4):
        assert (await _session(client, auth_headers, "lecture"))["passed"]
    ex = await _session(client, auth_headers, "exam")
    assert ex["passed"] and ex["enrollment"]["certified"]
    st = (await client.get("/api/v1/life/status", headers=auth_headers)).json()
    assert any(c["course"] == "computer_science" for c in st["certificates"])
    assert next(p for p in st["pro_careers"] if p["id"] == "developer")["unlocked"]
    d = (await client.get("/api/v1/life/dream/oga", headers=auth_headers)).json()
    assert d["milestones"][1]["done"]


async def test_rent_and_car_need_money(client, auth_headers):
    r = await client.post("/api/v1/life/rent", headers=auth_headers)
    if r.status_code == 200:
        assert r.json()["housing"] == "rent"
        again = await client.post("/api/v1/life/rent", headers=auth_headers)
        assert again.json()["detail"]["code"] == "rent_not_due"
    g = await client.post("/api/v1/life/car", json={"tier": 3}, headers=auth_headers)
    assert g.status_code == 409


async def test_npc_chat_and_date(client, auth_headers):
    r = await client.post("/api/v1/social/npc-chat", json={"npc_id": "npc_amina", "text": "Sannu! How was work at the hospital today?"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    rel = r.json()["relationship"]
    assert rel["friendship"] > 0 and rel["memory"]
    for _ in range(8):
        await client.post("/api/v1/social/like", json={"kind": "npc", "id": "npc_amina"}, headers=auth_headers)
    d = await client.post("/api/v1/social/date/start", json={"rel_id": rel["id"], "place": "park"}, headers=auth_headers)
    assert d.status_code == 200, d.text
    out = d.json()
    while not out.get("finished"):
        out = (await client.post("/api/v1/social/date/choose", json={"rel_id": rel["id"], "choice": 0}, headers=auth_headers)).json()
    assert out["outcome"] in ("great", "okay", "bad")
    w = await client.post("/api/v1/social/wedding", json={"rel_id": rel["id"]}, headers=auth_headers)
    assert w.status_code == 409


async def test_dms_between_players(client, auth_headers):
    h2, reg2 = await _new(client)
    me2 = (await client.get("/api/v1/players/me", headers=h2)).json()
    r = await client.post("/api/v1/social/dm", json={"to": me2["id"], "text": "Ina kwana!"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    c = (await client.get("/api/v1/social/relationships", headers=h2)).json()["relationships"]
    assert c and c[0]["unread"] == 1
    me1 = (await client.get("/api/v1/players/me", headers=auth_headers)).json()
    t = (await client.get(f"/api/v1/social/dm/{me1['id']}", headers=h2)).json()["messages"]
    assert t[0]["text"] == "Ina kwana!"


@pytest.mark.parametrize("game", ["ayo", "whot", "ludo", "trivia"])
async def test_games_vs_bots(client, auth_headers, game):
    m = (await client.post("/api/v1/games/join", json={"game": game, "vs_bots": True}, headers=auth_headers)).json()
    assert m["status"] in ("playing", "done"), m
    me = m["you"]
    from app.services.games_engine import GAMES
    import copy

    from app.models.life import GameMatch
    for _ in range(300):
        if m["status"] == "done":
            break
        if game != "trivia" and m["turn"] != me:
            m = (await client.get(f"/api/v1/games/match/{m['id']}", headers=auth_headers)).json()
            continue
        # ask the engine's bot what a sensible move is, using the raw state
        from app.db.session import AsyncSessionLocal as SessionLocal

        async with SessionLocal() as db:
            row = await db.get(GameMatch, m["id"])
            mv = GAMES[game]["bot"](copy.deepcopy(row.state), me)
        r = await client.post(f"/api/v1/games/match/{m['id']}/move", json={"move": mv}, headers=auth_headers)
        if r.status_code != 200:
            m = (await client.get(f"/api/v1/games/match/{m['id']}", headers=auth_headers)).json()
            if game == "trivia":
                break
            continue
        m = r.json()
    assert m["state"]
    print(game, m["status"], m["winner"])


async def test_stake_escrow_and_leave_refund(client, auth_headers):
    before = (await client.get("/api/v1/players/me", headers=auth_headers)).json()["ngn_balance_minor"]
    m = (await client.post("/api/v1/games/join", json={"game": "ayo", "stake": 10_000}, headers=auth_headers)).json()
    assert m["status"] == "waiting"
    mid = (await client.get("/api/v1/players/me", headers=auth_headers)).json()["ngn_balance_minor"]
    assert mid == before - 10_000
    await client.post(f"/api/v1/games/match/{m['id']}/leave", headers=auth_headers)
    after = (await client.get("/api/v1/players/me", headers=auth_headers)).json()["ngn_balance_minor"]
    assert after == before
    big = await client.post("/api/v1/games/join", json={"game": "ayo", "stake": 10**9}, headers=auth_headers)
    assert big.status_code == 409


async def test_two_humans_share_a_table(client, auth_headers):
    h2, _ = await _new(client)
    a = (await client.post("/api/v1/games/join", json={"game": "ayo"}, headers=auth_headers)).json()
    b = (await client.post("/api/v1/games/join", json={"game": "ayo"}, headers=h2)).json()
    assert a["id"] == b["id"] and b["status"] == "playing"


async def test_races(client, auth_headers):
    r = (await client.get("/api/v1/races")).json()["routes"]
    assert r
    bad = await client.post("/api/v1/races/time", json={"route": "bridge_dash", "ms": 1000}, headers=auth_headers)
    assert bad.status_code == 422
    ok = await client.post("/api/v1/races/time", json={"route": "bridge_dash", "ms": 60000}, headers=auth_headers)
    assert ok.status_code == 200 and ok.json()["prize"] > 0
    again = await client.post("/api/v1/races/time", json={"route": "bridge_dash", "ms": 70000}, headers=auth_headers)
    assert again.json()["prize"] == 0
    assert ok.json()["leaderboard"][0]["ms"] == 60000


async def test_event_prize_cooldown(client, auth_headers):
    a = (await client.post("/api/v1/life/event", json={"event": "dance_battle", "won": True}, headers=auth_headers)).json()
    b = (await client.post("/api/v1/life/event", json={"event": "dance_battle", "won": True}, headers=auth_headers)).json()
    assert a["prize"] > 0 and b["prize"] == 0
    met = await client.post("/api/v1/social/met", json={"npc_id": "ped_12", "name": "Hajiya Fatima Bello"}, headers=auth_headers)
    assert met.status_code == 200 and met.json()["relationship"]["memory"]


async def test_race_hub_shared_start(monkeypatch):
    from app.events import race_hub as rh

    sent = []

    async def fake_send(pid, msg):
        sent.append((pid, msg))

    monkeypatch.setattr(rh.manager, "send_to_player", fake_send)
    hub = rh.RaceHub()
    await hub.handle("a", "Ada", "race.join", {"route": "bridge_dash"})
    await hub.handle("b", "Bala", "race.join", {"route": "bridge_dash"})
    await hub.handle("a", "Ada", "race.ready", {})
    lb = hub.lobbies["bridge_dash"]
    assert lb["start_at"] > 0 and len(lb["players"]) == 2
    await hub.handle("b", "Bala", "race.progress", {"cp": 3, "ms": 9000})
    last = [m for p, m in sent if p == "a"][-1]["payload"]
    assert any(p["id"] == "b" and p["cp"] == 3 for p in last["players"])


async def test_arcade_scores(client, auth_headers):
    r = await client.post("/api/v1/arcade/score", json={"game": "snake", "score": 42}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["new_best"]
    r2 = await client.post("/api/v1/arcade/score", json={"game": "snake", "score": 10}, headers=auth_headers)
    assert r2.json()["best"] == 42 and not r2.json()["new_best"]
    bad = await client.post("/api/v1/arcade/score", json={"game": "snake", "score": 10**9}, headers=auth_headers)
    assert bad.status_code == 422
    lb = (await client.get("/api/v1/arcade/snake", headers=auth_headers)).json()
    assert lb["best"] == 42 and lb["leaderboard"][0]["score"] >= 42


async def test_travel_between_towns(client, auth_headers):
    t = (await client.get("/api/v1/world/towns", headers=auth_headers)).json()
    assert t["current"] == "kaduna" and any(x["id"] == "zaria" for x in t["towns"])
    before = (await client.get("/api/v1/players/me", headers=auth_headers)).json()
    r = await client.post("/api/v1/world/travel", json={"region": "zaria"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    me = (await client.get("/api/v1/players/me", headers=auth_headers)).json()
    assert me["region_slug"] == "zaria" and me["ngn_balance_minor"] == before["ngn_balance_minor"] - 250_000
    again = await client.post("/api/v1/world/travel", json={"region": "zaria"}, headers=auth_headers)
    assert again.status_code == 409
    back = await client.post("/api/v1/world/travel", json={"region": "kaduna"}, headers=auth_headers)
    assert back.status_code == 200 and back.json()["slug"] == "kaduna-city"


async def _rich(player_id: str, amount: int = 50_000_000):
    from app.db.session import AsyncSessionLocal
    from app.services import life_service

    async with AsyncSessionLocal() as db:
        life_service.credit(db, player_id, amount, "test_seed", "test money")
        await db.commit()


async def test_family_business_health_politics(client, auth_headers):
    me = (await client.get("/api/v1/players/me", headers=auth_headers)).json()
    await _rich(me["id"], 300_000_000)
    # family needs a marriage
    r = await client.post("/api/v1/family/baby", json={"name": "Amina", "gender": "girl"}, headers=auth_headers)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "not_married"
    from app.db.session import AsyncSessionLocal
    from app.services import social_service

    async with AsyncSessionLocal() as db:
        rel = await social_service.get_rel(db, me["id"], "npc", "npc_zainab")
        rel.status = "married"
        await db.commit()
    kid = (await client.post("/api/v1/family/baby", json={"name": "Amina", "gender": "girl"}, headers=auth_headers)).json()["child"]
    fed = (await client.post("/api/v1/family/care", json={"child_id": kid["id"], "action": "feed"}, headers=auth_headers)).json()["child"]
    assert fed["hunger"] == 100
    fam = (await client.get("/api/v1/family", headers=auth_headers)).json()
    assert fam["spouse"] and len(fam["children"]) == 1
    # business: open, restock, price, hire, upgrade
    await client.post("/api/v1/life/rent", headers=auth_headers)
    r = await client.post("/api/v1/life/business", json={"kind": "shop", "name": "Mama Shop"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    b = (await client.post("/api/v1/business/action", json={"action": "restock", "value": 40}, headers=auth_headers)).json()
    assert b["stock"] == 100
    b = (await client.post("/api/v1/business/action", json={"action": "price", "value": 120}, headers=auth_headers)).json()
    assert b["price_pct"] == 120
    b = (await client.post("/api/v1/business/action", json={"action": "hire"}, headers=auth_headers)).json()
    assert b["staff"] == 1
    b = (await client.post("/api/v1/business/action", json={"action": "upgrade"}, headers=auth_headers)).json()
    assert b["level"] == 2 and b["level_name"] == "Supermarket"
    assert (await client.post("/api/v1/business/collect", headers=auth_headers)).status_code == 409  # too early
    # health
    h = (await client.get("/api/v1/health/me", headers=auth_headers)).json()
    assert 0 < h["health"] <= 100 and h["stamina"] >= 50
    h2 = (await client.post("/api/v1/health/hospital", headers=auth_headers)).json()
    assert h2["sick"] is None
    # politics: rep gate then campaign
    p = (await client.post("/api/v1/politics/declare", headers=auth_headers))
    if p.status_code == 200:
        c = (await client.post("/api/v1/politics/campaign", json={"action": "door_to_door"}, headers=auth_headers)).json()
        assert c["campaign"]["support"] > 0
        again = await client.post("/api/v1/politics/campaign", json={"action": "door_to_door"}, headers=auth_headers)
        assert again.status_code == 409
    else:
        assert p.json()["detail"]["code"] == "not_enough_reputation"


async def test_crews_gifts_town_jobs(client, auth_headers):
    me = (await client.get("/api/v1/players/me", headers=auth_headers)).json()
    await _rich(me["id"])
    h2, _ = await _new(client)
    other = (await client.get("/api/v1/players/me", headers=h2)).json()
    c = (await client.post("/api/v1/crews", json={"name": f"Kawo Kings {me['id'][:4]}", "tag": "KWK"}, headers=auth_headers)).json()["crew"]
    j = await client.post(f"/api/v1/crews/{c['id']}/join", headers=h2)
    assert j.status_code == 200 and len(j.json()["crew"]["members"]) == 2
    await client.post("/api/v1/crews/say", json={"text": "Night meet at 9!"}, headers=auth_headers)
    cr = (await client.get("/api/v1/crews", headers=h2)).json()
    assert cr["messages"][-1]["text"] == "Night meet at 9!"
    before = other["ngn_balance_minor"]
    g = await client.post("/api/v1/gifts", json={"to": other["id"], "amount": 100_000}, headers=auth_headers)
    assert g.status_code == 200
    after = (await client.get("/api/v1/players/me", headers=h2)).json()["ngn_balance_minor"]
    assert after == before + 100_000
    assert (await client.post("/api/v1/gifts", json={"to": other["id"], "amount": 10**9}, headers=auth_headers)).status_code == 409
    # town jobs: Zaria jobs only in Zaria
    jobs = [c["id"] for c in (await client.get("/api/v1/work/state", headers=auth_headers)).json()["careers"]]
    assert "sabon_gari_trader" not in jobs
    await client.post("/api/v1/world/travel", json={"region": "zaria"}, headers=auth_headers)
    jobs = [c["id"] for c in (await client.get("/api/v1/work/state", headers=auth_headers)).json()["careers"]]
    assert "sabon_gari_trader" in jobs and "shop" not in jobs
    r = await client.post("/api/v1/work/clock-in", json={"career": "sabon_gari_trader"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    act = await client.post("/api/v1/activities/do", json={"id": "polo"}, headers=auth_headers)
    assert act.status_code == 200
    wrong = await client.post("/api/v1/activities/do", json={"id": "kagoro_hike"}, headers=auth_headers)
    assert wrong.status_code == 409


async def test_private_head_to_head_invite(client, auth_headers):
    h2, reg2 = await _new(client)
    me = (await client.get("/api/v1/players/me", headers=h2)).json()
    friend_id = me.get("id") or me.get("player", {}).get("id")
    a = (await client.post("/api/v1/games/join", json={"game": "whot", "invite": friend_id}, headers=auth_headers)).json()
    assert a["status"] == "waiting" and a["invite"] == friend_id
    # a stranger looking for a public table never lands on the private one
    h3, _ = await _new(client)
    c = (await client.post("/api/v1/games/join", json={"game": "whot"}, headers=h3)).json()
    assert c["id"] != a["id"]
    # a third person can't accept someone else's invite
    bad = await client.post("/api/v1/games/join", json={"game": "whot", "match_id": a["id"]}, headers=h3)
    assert bad.status_code == 404
    b = (await client.post("/api/v1/games/join", json={"game": "whot", "match_id": a["id"]}, headers=h2)).json()
    assert b["id"] == a["id"] and b["status"] == "playing" and len(b["players"]) == 2
