"""Kaduna Kulture - FastAPI application assembly.

Authoritative game server: REST under /api/v1, WebSocket at /ws/game.
Lifespan bootstraps schema (dev convenience + Alembic for real migrations),
seeds the world when empty, and starts the background workers.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import func, select

from app.agents.llm_client import llm_client
from app.core.config import settings
from app.db.session import AsyncSessionLocal, engine
from app.api.router import api_root
from app.models import Base
from app.models.world import WorldRegion
from app.seed.seed_data import reconcile_world_scale, seed_if_empty
from app.workers.runner import start_all

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
log = logging.getLogger("kk.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)  # dev convenience; Alembic owns prod migrations
    async with AsyncSessionLocal() as db:
        seeded = await seed_if_empty(db)
        if seeded:
            log.info("World seeded: Ali Akilu Road is open for business.")
        else:
            moved = await reconcile_world_scale(db)
            if moved:
                log.info("World rescaled to x%s: %d rows updated.", settings.world_scale, moved)
    workers = start_all()
    log.info("Kaduna Kulture backend up (env=%s, lightning=%s)", settings.env, settings.lightning_provider)
    try:
        yield
    finally:
        for t in workers:
            t.cancel()
        await llm_client.close()
        await engine.dispose()
        log.info("Kaduna Kulture backend shut down cleanly.")


app = FastAPI(
    title=f"{settings.app_name} API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Never leak stack traces or internal details to clients (spec error_format).
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "detail": {
                "code": "internal_error",
                "message": "Something broke on our side. Abeg try again.",
                "request_id": "n/a",
                "retryable": True,
            }
        },
    )


app.include_router(api_root)
