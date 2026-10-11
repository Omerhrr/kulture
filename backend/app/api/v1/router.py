"""API v1 router assembly."""

from fastapi import APIRouter

from app.api.v1 import auth, economy, health, payments, players, world

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(players.router)
api_router.include_router(world.router)
api_router.include_router(economy.router)
api_router.include_router(payments.router)
api_router.include_router(health.router)
