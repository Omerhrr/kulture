"""Root router: mounts API v1 + game WebSocket."""

from fastapi import APIRouter

from app.api.v1.router import api_router
from app.api.ws import router as ws_router

api_root = APIRouter()
api_root.include_router(api_router, prefix="/api/v1")
api_root.include_router(ws_router)
