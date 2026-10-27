"""Test configuration - file-based SQLite, fresh DB per session, no LLM."""

from __future__ import annotations


import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# KK_TEST_DATABASE_URL=postgresql+asyncpg://... runs the suite on Postgres
# (the production database); the schema there is dropped and rebuilt.
_PG_TEST = os.environ.get("KK_TEST_DATABASE_URL", "")
os.environ["KK_DATABASE_URL"] = _PG_TEST or "sqlite+aiosqlite:///" + os.path.join(
    os.path.dirname(__file__), "test_kaduna.db"
)
os.environ["KK_LLM_ENABLED"] = "false"
# the payment state machine runs against the in-process simulator in CI;
# real play uses a testnet node (KK_LIGHTNING_PROVIDER=lnbits | lnd)
os.environ["KK_LIGHTNING_PROVIDER"] = "mock"
os.environ["KK_LIGHTNING_MOCK_ENABLED"] = "true"
os.environ["KK_LIGHTNING_NETWORK"] = "regtest"
# the suite signs up a fresh player per test from one address
os.environ.setdefault("KK_AUTH_REGISTER_PER_IP_PER_HOUR", "100000")
os.environ.setdefault("KK_AUTH_LOGIN_PER_IP_PER_10MIN", "100000")
os.environ["KK_JWT_SECRET"] = "test-secret-0123456789abcdef-0123456789abcdef"
# Tests run DB sessions on multiple event loops (pytest-asyncio session loop +
# starlette TestClient portals) - never share pooled connections across loops.
os.environ["KK_DB_NULL_POOL"] = "true"

# Fresh DB per session: a stale file would keep old usernames alive and fail
# registration tests with 409 conflicts.
_TEST_DB = os.path.join(os.path.dirname(__file__), "test_kaduna.db")
if os.path.exists(_TEST_DB):
    os.remove(_TEST_DB)

import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _setup_db():
    from app.db.session import engine
    from app.models import Base
    from app.seed.seed_data import reconcile_content, seed_if_empty
    from app.db.session import AsyncSessionLocal

    async with engine.begin() as conn:
        if _PG_TEST:
            await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    async with AsyncSessionLocal() as db:
        await seed_if_empty(db)
        await reconcile_content(db)  # district content, as on app boot
        from app.services.travel_service import ensure_regions

        await ensure_regions(db)
    yield
    await engine.dispose()


@pytest_asyncio.fixture
async def client():
    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def auth_headers(client) -> dict:
    import uuid

    username = f"tester_{uuid.uuid4().hex[:8]}"
    reg = await client.post(
        "/api/v1/auth/register",
        json={"username": username, "password": "suyaspice123", "display_name": "Test Rider"},
    )
    assert reg.status_code == 201, reg.text
    token = reg.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def world_ctx(client, auth_headers) -> dict:
    """Region + key entities + musa's business for flow tests."""
    reg = (await client.get("/api/v1/world/regions/kaduna-city", headers=auth_headers)).json()
    entities = {e["code"]: e for e in reg["entities"]}
    biz = (
        await client.get(f"/api/v1/businesses/{entities['musa_shop']['business_id']}", headers=auth_headers)
    ).json()
    return {"region": reg, "entities": entities, "business": biz}
