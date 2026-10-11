"""Test configuration — file-based SQLite, fresh DB per session, no LLM."""

from __future__ import annotations


import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ["KK_DATABASE_URL"] = "sqlite+aiosqlite:///" + os.path.join(
    os.path.dirname(__file__), "test_kaduna.db"
)
os.environ["KK_LLM_ENABLED"] = "false"
os.environ["KK_JWT_SECRET"] = "test-secret"

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _setup_db():
    from app.db.session import engine
    from app.models import Base
    from app.seed.seed_data import seed_if_empty
    from app.db.session import AsyncSessionLocal

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with AsyncSessionLocal() as db:
        await seed_if_empty(db)
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
    reg = (await client.get("/api/v1/world/regions/ali-akilu-road", headers=auth_headers)).json()
    entities = {e["code"]: e for e in reg["entities"]}
    biz = (
        await client.get(f"/api/v1/businesses/{entities['musa_shop']['business_id']}", headers=auth_headers)
    ).json()
    return {"region": reg, "entities": entities, "business": biz}
