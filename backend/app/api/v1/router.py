"""API v1 router assembly."""

from fastapi import APIRouter

from app.api.v1 import ads, ask, home, venues, life, social, games, races, arcade, society, story, wallet, stores, auth, economy, health, payments, players, work, world

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
api_router.include_router(life.router)
api_router.include_router(social.router)
api_router.include_router(games.router)
api_router.include_router(races.router)
api_router.include_router(arcade.router)
api_router.include_router(society.router)
api_router.include_router(story.router)
api_router.include_router(wallet.router)
api_router.include_router(stores.router)
