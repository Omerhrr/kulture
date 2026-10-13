"""API v1 router assembly."""

from fastapi import APIRouter

from app.api.v1 import ads, ask, home, venues, auth, economy, health, payments, players, work, world

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(players.router)
api_router.include_router(world.router)
api_router.include_router(economy.router)
api_router.include_router(payments.router)
api_router.include_router(health.router)
api_router.include_router(work.router)
api_router.include_router(ask.router)
api_router.include_router(ads.router)
api_router.include_router(home.router)
api_router.include_router(venues.router)
