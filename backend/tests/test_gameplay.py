"""Auth, world, and gameplay flow tests (spec: gameplay_tests)."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


async def test_health(client):
    r = await client.get("/api/v1/health/live")
    assert r.status_code == 200
    assert r.json()["status"] == "live"


async def test_register_and_me(client, auth_headers):
    r = await client.get("/api/v1/players/me", headers=auth_headers)
    assert r.status_code == 200
    me = r.json()
    assert me["ngn_balance_minor"] == 2_500_000  # ₦25,000.00 in kobo
    assert me["reputation"] == 0
    assert me["position"] is not None


async def test_login_works(client):
    reg = await client.post(
        "/api/v1/auth/register",
        json={"username": "login_guy", "password": "zobolove99", "display_name": "Login Guy"},
    )
    assert reg.status_code == 201
    login = await client.post(
        "/api/v1/auth/login", json={"username": "login_guy", "password": "zobolove99"}
    )
    assert login.status_code == 200
    assert login.json()["access_token"]


async def test_duplicate_username_rejected(client):
    body = {"username": "dup_user", "password": "password123", "display_name": "Dup"}
    assert (await client.post("/api/v1/auth/register", json=body)).status_code == 201
    assert (await client.post("/api/v1/auth/register", json=body)).status_code == 409


async def test_region_payload(client, auth_headers, world_ctx):
    region = world_ctx["region"]
    codes = {e["code"] for e in region["entities"]}
    assert {"musa_shop", "arewa_pos", "kaduna_central_market", "arewa_house",
            "stonetech_square", "keke_stop"} <= codes
    # spec landmarks present
    assert world_ctx["business"]["code"] == "musa_provision_store"
    assert len(world_ctx["business"]["listings"]) >= 5


async def test_interaction_distance_validated_server_side(client, auth_headers, world_ctx):
    """Server-authoritative (P1): REST interactions use the SERVER-stored
    position - the client-supplied position is never trusted."""
    from app.db.session import AsyncSessionLocal
    from app.services import player_service

    entities = world_ctx["entities"]
    musa = entities["musa_shop"]
    spawn = entities["spawn_roadside"]
    # from spawn - too far from the shop
    far = await client.post(
        "/api/v1/interactions",
        headers=auth_headers,
        json={"entity_id": musa["id"], "position": [spawn["position"][0], 0, spawn["position"][2]]},
    )
    assert far.status_code == 422
    # fabricated proximity - claiming to stand at the shop without moving there
    fake = await client.post(
        "/api/v1/interactions",
        headers=auth_headers,
        json={"entity_id": musa["id"], "position": musa["position"]},
    )
    assert fake.status_code == 422, "client position must not be trusted"
    # after a REAL server-side move to the shop - allowed, offers shop options
    me = (await client.get("/api/v1/players/me", headers=auth_headers)).json()
    async with AsyncSessionLocal() as db:
        await player_service.apply_movement(
            db, me["id"], musa["position"][0], 0.0, musa["position"][2], 0.0
        )
    near = await client.post(
        "/api/v1/interactions",
        headers=auth_headers,
        json={"entity_id": musa["id"], "position": [spawn["position"][0], 0, spawn["position"][2]]},
    )
    assert near.status_code == 200, "server position should win over the lying body"
    kinds = [o["kind"] for o in near.json()["options"]]
    assert "shop" in kinds


async def test_delivery_job_full_loop(client, auth_headers, world_ctx):
    entities = world_ctx["entities"]
    jobs = (await client.get("/api/v1/jobs/available", headers=auth_headers)).json()
    assert len(jobs) >= 1
    job = jobs[0]

    acc = await client.post(f"/api/v1/jobs/{job['id']}/accept", headers=auth_headers)
    assert acc.status_code == 200
    assert acc.json()["status"] == "assigned"

    me_before = (await client.get("/api/v1/players/me", headers=auth_headers)).json()

    # pickup too far → rejected
    bad = await client.post(
        f"/api/v1/jobs/{job['id']}/pickup",
        headers=auth_headers,
        json={"position": [0.0, 0.0, 42.0]},
    )
    assert bad.status_code == 422

    ok = await client.post(
        f"/api/v1/jobs/{job['id']}/pickup",
        headers=auth_headers,
        json={"position": entities["musa_shop"]["position"]},
    )
    assert ok.status_code == 200
    assert ok.json()["pickup_state"] == "picked_up"

    # parcel is in inventory now
    inv = (await client.get("/api/v1/players/me/inventory", headers=auth_headers)).json()
    assert any(i["code"] == "quest_parcel" for i in inv["items"])

    done = await client.post(
        f"/api/v1/jobs/{job['id']}/complete",
        headers=auth_headers,
        json={"position": entities["stonetech_square"]["position"]},
    )
    assert done.status_code == 200
    me_after = done.json()
    assert me_after["ngn_balance_minor"] == me_before["ngn_balance_minor"] + 8_000_00
    assert me_after["reputation"] == me_before["reputation"] + 5

    # parcel consumed
    inv2 = (await client.get("/api/v1/players/me/inventory", headers=auth_headers)).json()
    assert not any(i["code"] == "quest_parcel" and i["quantity"] > 0 for i in inv2["items"])


async def test_job_cannot_be_double_accepted(client, auth_headers, world_ctx):
    jobs = (await client.get("/api/v1/jobs/available", headers=auth_headers)).json()
    if not jobs:
        pytest.skip("no available jobs left (consumed by earlier test)")
    job = jobs[0]
    h2 = auth_headers
    assert (await client.post(f"/api/v1/jobs/{job['id']}/accept", headers=h2)).status_code == 200
    other = await client.post(
        "/api/v1/auth/register",
        json={"username": "job_snatcher", "password": "password123", "display_name": "Snatch"},
    )
    assert (await client.post(
        f"/api/v1/jobs/{job['id']}/accept",
        headers={"Authorization": f"Bearer {other.json()['access_token']}"},
    )).status_code == 422
