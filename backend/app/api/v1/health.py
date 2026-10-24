"""Health / readiness endpoints (spec: /health/live, /health/ready)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.payments.lightning_service import get_adapter

router = APIRouter(tags=["health"])


@router.get("/health/live")
async def live() -> dict:
    return {"status": "live", "env": settings.env, "service": "kaduna-kulture-backend"}


@router.get("/health/ready")
async def ready(db: AsyncSession = Depends(get_db), response: Response = Response()) -> dict:
    checks: dict = {}
    healthy = True
    try:
        await db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:  # noqa: BLE001
        checks["database"] = f"error: {type(exc).__name__}"
        healthy = False
    try:
        checks["lightning"] = await get_adapter().get_node_health()
    except Exception as exc:  # noqa: BLE001
        checks["lightning"] = {"healthy": False, "error": type(exc).__name__}
        healthy = False
    return {"status": "ready" if healthy else "degraded", "checks": checks}
