"""Workplace shifts: on-site clock in, minimum duration, exactly-once pay,
commute destinations, and the Ask endpoint's offline fallback."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
# NOTE: asyncio_mode = auto (pytest.ini) collects the async tests; no module
# mark, or the sync tests below get stamped with asyncio and warn.


async def _me(client, h):
    return (await client.get("/api/v1/players/me", headers=h)).json()


async def _place(code: str):
    from app.db.session import AsyncSessionLocal
    from app.models.world import WorldEntity

    async with AsyncSessionLocal() as db:
        e = (await db.execute(select(WorldEntity).where(WorldEntity.code == code))).scalar_one()
        return e.position_x, e.position_z


async def _move(player_id: str, x: float, z: float):
    from app.db.session import AsyncSessionLocal
    from app.services import player_service

    async with AsyncSessionLocal() as db:
        await player_service.apply_movement(db, player_id, x, 0.0, z, 0.0)


async def _age_shift(player_id: str, seconds: float):
    from app.db.session import AsyncSessionLocal
    from app.models.work import WorkShift

    async with AsyncSessionLocal() as db:
        s = (await db.execute(select(WorkShift).where(WorkShift.player_id == player_id, WorkShift.status == "active"))).scalar_one()
        s.started_at = datetime.now(timezone.utc) - timedelta(seconds=seconds)
        await db.commit()


async def test_careers_listed(client, auth_headers):
    r = await client.get("/api/v1/work/state", headers=auth_headers)
    assert r.status_code == 200
    ids = {c["id"] for c in r.json()["careers"]}
    assert {"shop", "textile", "motorpark", "campus", "rail"} <= ids
    assert r.json()["shift"] is None


async def test_clock_in_requires_being_on_site(client, auth_headers):
    me = await _me(client, auth_headers)
    x, z = await _place("kasu_gate")
    await _move(me["id"], x + 500, z)
    r = await client.post("/api/v1/work/clock-in", json={"career": "campus"}, headers=auth_headers)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "not_at_workplace"


async def test_full_shift_pays_exactly_once(client, auth_headers):
    me = await _me(client, auth_headers)
    start = me["ksats_balance"]
    x, z = await _place("musa_shop")
    await _move(me["id"], x + 3, z)
    r = await client.post("/api/v1/work/clock-in", json={"career": "shop"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    # a second clock-in is refused while on shift
    assert (await client.post("/api/v1/work/clock-in", json={"career": "shop"}, headers=auth_headers)).status_code == 409
    # tasks are paced by real time
    assert (await client.post("/api/v1/work/task", headers=auth_headers)).status_code == 409
    await _age_shift(me["id"], 10_000)
    for _ in range(4):
        assert (await client.post("/api/v1/work/task", headers=auth_headers)).status_code == 200
    assert (await client.post("/api/v1/work/task", headers=auth_headers)).status_code == 409  # capped at 4
    out = await client.post("/api/v1/work/clock-out", headers=auth_headers)
    assert out.status_code == 200
    shift = out.json()["shift"]
    assert shift["status"] == "paid"
    assert shift["paid_ksats"] == int(12_000_00 * 1.15)
    assert (await _me(client, auth_headers))["ksats_balance"] == start + shift["paid_ksats"]
    # clocking out again pays nothing more
    assert (await client.post("/api/v1/work/clock-out", headers=auth_headers)).status_code == 409
    assert (await _me(client, auth_headers))["ksats_balance"] == start + shift["paid_ksats"]


async def test_leaving_early_pays_nothing(client, auth_headers):
    me = await _me(client, auth_headers)
    start = me["ksats_balance"]
    x, z = await _place("rigasa_station")
    await _move(me["id"], x, z + 2)
    assert (await client.post("/api/v1/work/clock-in", json={"career": "rail"}, headers=auth_headers)).status_code == 200
    out = (await client.post("/api/v1/work/clock-out", headers=auth_headers)).json()["shift"]
    assert out["status"] == "left_early" and out["paid_ksats"] == 0
    assert (await _me(client, auth_headers))["ksats_balance"] == start


async def test_walking_off_site_forfeits_pay(client, auth_headers):
    me = await _me(client, auth_headers)
    x, z = await _place("textile_market")
    await _move(me["id"], x, z)
    assert (await client.post("/api/v1/work/clock-in", json={"career": "textile"}, headers=auth_headers)).status_code == 200
    await _age_shift(me["id"], 10_000)
    await _move(me["id"], x + 400, z)
    out = (await client.post("/api/v1/work/clock-out", headers=auth_headers)).json()["shift"]
    assert out["status"] == "left_early"


async def test_commute_destinations_are_whitelisted():
    from app.db.session import AsyncSessionLocal
    from app.services.shift_service import commute_destination

    sx, sz = await _place("spawn_roadside")
    async with AsyncSessionLocal() as db:
        assert await commute_destination(db, "kasu_gate", None) is not None
        assert await commute_destination(db, "home", [sx + 20, sz - 10]) is not None
        assert await commute_destination(db, "home", [sx + 5000, sz]) is None  # not near home
        assert await commute_destination(db, "anywhere", None) is None
        assert await commute_destination(db, "npc_musa", None) is None  # people aren't destinations
        assert await commute_destination(db, "arewa_house", None) is not None  # map travel


async def test_ask_falls_back_offline_without_llm(client, auth_headers):
    r = await client.post("/api/v1/ask", json={"question": "How do I get a job?"}, headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["answer"] is None and r.json()["source"] == "offline"


def test_presence_look_is_whitelisted():
    from app.events.presence import clean_look

    out = clean_look({"body": "woman", "top": "#2f5fa8", "hair": "<script>", "skin": "red", "extra": 1})
    assert out == {"body": "woman", "top": "#2f5fa8"}


def test_melee_targets_only_players_in_front_and_in_reach():
    from app.events.presence import PresenceRegistry

    reg = PresenceRegistry()
    reg._p.clear()
    from app.events.presence import Presence

    reg._p["a"] = Presence("a", "attacker", [0.0, 0.0, 0.0], facing=0.0)  # faces +z
    reg._p["front"] = Presence("front", "victim", [0.0, 0.0, 1.2])
    reg._p["behind"] = Presence("behind", "bystander", [0.0, 0.0, -0.8])
    reg._p["far"] = Presence("far", "faraway", [0.0, 0.0, 5.0])
    t = reg.melee_target("a")
    assert t is not None and t[0].player_id == "front" and t[1][1] > 0.9
    del reg._p["front"]
    assert reg.melee_target("a") is None  # behind and far players are never hit
