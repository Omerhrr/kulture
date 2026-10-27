"""Open sign-up: anyone can create an account; no shared demo login."""

import uuid

import pytest

pytestmark = pytest.mark.asyncio


def _name() -> str:
    return f"Rider_{uuid.uuid4().hex[:8]}"


async def test_signup_then_play(client):
    name = _name()
    r = await client.post("/api/v1/auth/register", json={"username": name, "password": "suyaspice123", "display_name": "  Amina   B  "})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    me = (await client.get("/api/v1/players/me", headers=h)).json()
    assert me["display_name"] == "Amina B"
    assert me["username"] == name.lower()
    assert me["ksats_balance"] > 0  # starting money


async def test_usernames_are_case_insensitive(client):
    name = _name()
    r = await client.post("/api/v1/auth/register", json={"username": name, "password": "suyaspice123", "display_name": "A"})
    assert r.status_code == 201
    dup = await client.post("/api/v1/auth/register", json={"username": name.upper(), "password": "suyaspice123", "display_name": "B"})
    assert dup.status_code == 409
    ok = await client.post("/api/v1/auth/login", json={"username": name.upper(), "password": "suyaspice123"})
    assert ok.status_code == 200


@pytest.mark.parametrize("body", [
    {"username": "ab", "password": "suyaspice123", "display_name": "x"},
    {"username": "bad name!", "password": "suyaspice123", "display_name": "x"},
    {"username": "fine_name", "password": "short", "display_name": "x"},
])
async def test_signup_validation(client, body):
    assert (await client.post("/api/v1/auth/register", json=body)).status_code == 422


async def test_failed_logins_are_limited_per_username(client):
    name = _name()
    await client.post("/api/v1/auth/register", json={"username": name, "password": "suyaspice123", "display_name": "A"})
    codes = [(await client.post("/api/v1/auth/login", json={"username": name, "password": "wrong-pass"})).status_code for _ in range(9)]
    assert codes[:8] == [401] * 8 and codes[8] == 429
    # even the right password waits it out now
    assert (await client.post("/api/v1/auth/login", json={"username": name, "password": "suyaspice123"})).status_code == 429


async def test_demo_account_is_not_seeded_and_old_one_is_locked(client):
    r = await client.post("/api/v1/auth/login", json={"username": "demo_player", "password": "kaduna-demo-2026"})
    assert r.status_code == 401

    # a database from before: demo account exists and holds a live token
    from app.core.security import hash_password
    from app.db.session import AsyncSessionLocal
    from app.models.player import User
    from app.seed.seed_data import retire_demo_account
    from app.services import player_service
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        if not (await db.execute(select(User).where(User.username == "demo_player"))).scalar_one_or_none():
            tok = await player_service.register_player(db, "demo_player", "kaduna-demo-2026", "Demo Player")
        else:
            u = (await db.execute(select(User).where(User.username == "demo_player"))).scalar_one()
            u.status, u.password_hash = "active", hash_password("kaduna-demo-2026")
            await db.commit()
            tok = await player_service.login_player(db, "demo_player", "kaduna-demo-2026")
    h = {"Authorization": f"Bearer {tok.access_token}"}
    assert (await client.get("/api/v1/players/me", headers=h)).status_code == 200

    async with AsyncSessionLocal() as db:
        assert await retire_demo_account(db) is True
        assert await retire_demo_account(db) is False  # idempotent
    assert (await client.get("/api/v1/players/me", headers=h)).status_code == 401
    r = await client.post("/api/v1/auth/login", json={"username": "demo_player", "password": "kaduna-demo-2026"})
    assert r.status_code == 401
