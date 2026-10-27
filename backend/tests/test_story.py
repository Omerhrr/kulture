"""The main story, played start to finish through the API: talk to each
giver on site, pick up and deliver the per-player parcel, open the shop."""

from __future__ import annotations

import uuid

from sqlalchemy import select

from app.services.story_service import CHAPTERS, POSTS, SHOP_GRANT_KSATS

# NOTE: asyncio_mode = auto (pytest.ini) collects the async tests.


async def _place(code: str) -> tuple[float, float]:
    from app.db.session import AsyncSessionLocal
    from app.models.world import WorldEntity

    async with AsyncSessionLocal() as db:
        e = (await db.execute(select(WorldEntity).where(WorldEntity.code == code))).scalar_one()
        return e.position_x, e.position_z


async def _go(player_id: str, code: str) -> list[float]:
    """Stand at a place (the authoritative position the server checks)."""
    from app.db.session import AsyncSessionLocal
    from app.models.player import PlayerState

    x, z = await _place(code)
    async with AsyncSessionLocal() as db:
        st = (await db.execute(select(PlayerState).where(PlayerState.player_id == player_id))).scalar_one()
        st.position_x, st.position_z = x + 2.0, z + 2.0
        await db.commit()
    return [x + 2.0, 0.0, z + 2.0]


async def _record(pid: str, kind: str, game: str) -> None:
    """A finished game won / a paid shift, as the game services leave them."""
    from datetime import datetime, timezone

    from app.db.session import AsyncSessionLocal
    from app.models.life import GameMatch
    from app.models.work import WorkShift

    async with AsyncSessionLocal() as db:
        if kind == "win":
            db.add(GameMatch(id=str(uuid.uuid4()), game=game, status="done", stake=0, asset="ksats", players=[{"id": pid, "name": "x", "bot": False}],
                             state={}, seq=1, winner=pid))
        else:
            db.add(WorkShift(player_id=pid, career="shop", status="paid", started_at=datetime.now(timezone.utc), ended_at=datetime.now(timezone.utc), paid_ksats=1_200_000))
        await db.commit()


async def _me(client, h) -> dict:
    return (await client.get("/api/v1/players/me", headers=h)).json()


def test_story_uses_real_places_and_people():
    from app.seed.seed_data import ENTITIES, NEW_ENTITIES

    codes = {c for c, *_ in [*ENTITIES, *NEW_ENTITIES]}
    for ch in CHAPTERS:
        assert ch.giver in codes and ch.giver in POSTS, ch.key
        for place in (ch.pickup, ch.dropoff):
            assert place is None or place in codes, ch.key
        assert ch.lines, ch.key
    # each delivery's receiver gives the next chapter (or it's Musa again):
    # the story walks you from person to person
    act1 = [c for c in CHAPTERS if c.act == 1]
    for a, b in zip(act1, act1[1:]):
        if a.kind == "delivery" and b.giver != "npc_musa":
            assert POSTS[b.giver] == a.dropoff, f"{a.key} -> {b.key}"


async def test_story_start_to_finish(client, auth_headers):
    h = auth_headers
    pid = (await _me(client, h))["id"]

    s = (await client.get("/api/v1/story", headers=h)).json()
    assert s["chapter"] == 0 and s["step"] == "talk" and s["target"] == "npc_musa"

    # talking from across town does nothing
    await _go(pid, "kawo_motor_park")
    r = await client.post("/api/v1/story/talk", json={"npc": "npc_musa"}, headers=h)
    assert r.status_code == 409

    start_ksats = (await _me(client, h))["ksats_balance"]
    paid = 0
    for i, ch in enumerate(CHAPTERS):
        s = (await client.get("/api/v1/story", headers=h)).json()
        assert s["chapter"] == i, (ch.key, s)
        if s["step"] == "talk":
            assert s["target"] == ch.giver
            # the wrong person has nothing for you
            other = next(n for n in POSTS if n != ch.giver)
            await _go(pid, POSTS[other])
            s2 = (await client.post("/api/v1/story/talk", json={"npc": other}, headers=h)).json()
            assert s2["chapter"] == i and s2["step"] == "talk"
            # the giver, at their post
            await _go(pid, POSTS[ch.giver])
            s = (await client.post("/api/v1/story/talk", json={"npc": ch.giver}, headers=h)).json()
            assert any(x["speaker"] == ch.giver for x in s["said"]), ch.key
        else:
            # handed over in the same conversation as the chapter before
            assert CHAPTERS[i - 1].giver == ch.giver and CHAPTERS[i - 1].kind == "meet"
        if ch.kind == "meet":
            continue
        if ch.kind == "business":
            assert s["step"] == "business" and s["have_ksats"] >= SHOP_GRANT_KSATS
            # a second talk never pays the stake twice
            before = (await _me(client, h))["ksats_balance"]
            await client.post("/api/v1/story/talk", json={"npc": ch.giver}, headers=h)
            assert (await _me(client, h))["ksats_balance"] == before
            # earn the rest, move out, open the shop
            from app.db.session import AsyncSessionLocal
            from app.models.ledger import GameLedgerEntry

            async with AsyncSessionLocal() as db:
                db.add(GameLedgerEntry(account_reference=f"player:{pid}", asset_type="ksats", amount_minor_units=30_000_000,
                                       transaction_reference=f"test:{uuid.uuid4().hex}", entry_type="test", description="shifts"))
                await db.commit()
            assert (await client.post("/api/v1/life/rent", headers=h)).status_code == 200
            r = await client.post("/api/v1/life/business", json={"kind": "shop", "name": "My Shop"}, headers=h)
            assert r.status_code == 200, r.text
            continue
        if ch.kind == "shelf":
            assert s["step"] == "shelf" and s["need"] == ch.need
            for item in ("suya_spice", "kuli_kuli", "zobo_concentrate")[: ch.need]:
                r = await client.post("/api/v1/stores/mine/restock", json={"item": item, "qty": 2}, headers=h)
                assert r.status_code == 200, r.text
            continue
        if ch.kind == "win":
            assert s["step"] == "win" and s["game"] == ch.game
            await _record(pid, "win", ch.game)
            continue
        if ch.kind == "shift":
            assert s["step"] == "shift"
            await _record(pid, "shift", "")
            continue
        assert s["step"] == "pickup" and s["target"] == ch.pickup and s["job_id"]
        job_id = s["job_id"]
        # the story job is yours: never on the public board
        board = (await client.get("/api/v1/jobs/available", headers=h)).json()
        assert job_id not in {j["id"] for j in board}
        pos = await _go(pid, ch.pickup)
        assert (await client.post(f"/api/v1/jobs/{job_id}/pickup", json={"position": pos}, headers=h)).status_code == 200
        s = (await client.get("/api/v1/story", headers=h)).json()
        assert s["step"] == "deliver" and s["target"] == ch.dropoff
        pos = await _go(pid, ch.dropoff)
        r = await client.post(f"/api/v1/jobs/{job_id}/complete", json={"position": pos}, headers=h)
        assert r.status_code == 200, r.text
        paid += ch.reward_ksats

    s = (await client.get("/api/v1/story", headers=h)).json()
    assert s["done"] and s["step"] == "free" and len(s["log"]) == len(CHAPTERS)
    assert not s["said"]  # nothing left to say
    # every non-delivery reward paid exactly once (by its own reference)
    hist = (await client.get("/api/v1/wallet", headers=h)).json()["history"]
    story_pay = [x for x in hist if x["kind"] == "story_reward"]
    expected = [c for c in CHAPTERS if c.kind != "delivery" and c.reward_ksats]
    assert len(story_pay) == len(expected) + 1  # + Musa's shop stake
    assert paid > 0 and start_ksats > 0
