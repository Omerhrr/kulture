"""Kaduna Kulture backend - application configuration.

Environment-based configuration (12-factor). All tunables come from
environment variables prefixed with ``KK_`` so the same image can run
local / test / production without code changes.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent.parent  # backend/


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="KK_", env_file=(BASE_DIR / ".env"), extra="ignore"
    )

    # ------------------------------------------------------------------
    # Runtime environment: local | test | production
    # ------------------------------------------------------------------
    env: str = "local"
    app_name: str = "Kaduna Kulture"
    api_v1_prefix: str = "/api/v1"

    # ------------------------------------------------------------------
    # Database - SQLite (aiosqlite) for local dev, PostgreSQL for
    # staging/production. SQLAlchemy URL, e.g.
    #   sqlite+aiosqlite:///./kaduna.db
    #   postgresql+asyncpg://kk:kk@db:5432/kaduna
    # ------------------------------------------------------------------
    database_url: str = f"sqlite+aiosqlite:///{BASE_DIR / 'kaduna.db'}"

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------
    jwt_secret: str = "dev-only-change-me-kaduna-kulture"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 12

    # ------------------------------------------------------------------
    # CORS
    # ------------------------------------------------------------------
    cors_origins: list[str] = ["*"]

    # ------------------------------------------------------------------
    # Lightning network adapter: "mock" (regtest-style simulator used for
    # local development and CI) or "ldk_node" (real LDK Node integration).
    # ------------------------------------------------------------------
    lightning_provider: str = "mock"
    lightning_mock_enabled: bool = True
    invoice_expiry_seconds: int = 600
    reconciliation_interval_seconds: int = 30

    # LDK node (used only when lightning_provider == "ldk_node")
    ldk_node_url: str = "http://127.0.0.1:8080"
    ldk_node_api_key: str = ""

    # ------------------------------------------------------------------
    # DSH agent runtime / LLM access (bring-your-own model access).
    # The default points at the local OpenAI-compatible bridge; point it
    # at api.deepseek.com with an API key for production-grade inference.
    # ------------------------------------------------------------------
    llm_base_url: str = "http://127.0.0.1:8100/v1"
    llm_api_key: str = "local-bridge"
    llm_model: str = "deepseek-chat"
    llm_timeout_seconds: float = 20.0
    llm_enabled: bool = True
    agent_max_actions_per_run: int = 4
    agent_run_timeout_seconds: float = 45.0

    # ------------------------------------------------------------------
    # Gameplay validation
    # ------------------------------------------------------------------
    interaction_radius: float = 6.0          # world units (1 unit = 1 m)

    # World scale (keep in sync with WORLD_SCALE in
    # frontend/app/utils/kaduna.ts). The OSM bake is stored at 1 unit = 10 m;
    # the playable city is stretched by this factor so map distances sit
    # close to the 1 unit = 1 m of people, cars and houses.
    world_scale: float = 3.0
    # raw (bake) bounds of the city map; scaled by world_scale at use
    world_raw_bounds: tuple[float, float, float, float] = (-1400.0, 700.0, -1020.0, 1450.0)
    movement_rate_limit_hz: float = 20.0     # WS movement messages per second
    job_reward_currency: str = "ngn_minor"

    # ------------------------------------------------------------------
    # Movement authority (P1 hardening) - the server reconciles client moves
    # through a speed envelope: a move may never advance the player more
    # than max_speed * dt (dt capped). Teleport attempts are clamped, and
    # REST interactions always use the server-stored position.
    # ------------------------------------------------------------------
    movement_max_speed_units_per_s: float = 48.0   # walk 5, sprint 9.5, road vehicles up to ~38
    movement_dt_cap_seconds: float = 1.0
    movement_persist_interval_seconds: float = 0.5  # DB write throttle per mover
    interactions_use_server_position: bool = True

    # ------------------------------------------------------------------
    # Real-node webhook authentication (P1 hardening).
    # POST /api/v1/payments/webhook stays disabled (503) until BOTH secrets
    # are configured. Auth = bearer token + HMAC-SHA256 over
    # "{timestamp}.{raw_body}" + timestamp tolerance window (anti-replay).
    # ------------------------------------------------------------------
    webhook_bearer_token: str = ""
    webhook_signature_secret: str = ""
    webhook_timestamp_tolerance_seconds: int = 300

    # ------------------------------------------------------------------
    # Test-only: disable connection pooling (NullPool) so sessions opened on
    # different event loops (pytest-asyncio session loop vs TestClient
    # portals) never share pooled aiosqlite connections.
    # ------------------------------------------------------------------
    db_null_pool: bool = False

    # ------------------------------------------------------------------
    # World simulation scheduler
    # ------------------------------------------------------------------
    world_event_interval_seconds: int = 240

    # ------------------------------------------------------------------
    # Payments / economy safety
    # ------------------------------------------------------------------
    # Dev-only endpoint that simulates an external wallet paying an
    # invoice. Hard-disabled unless env == "local" AND this flag is true.
    dev_payment_simulation: bool = True

    @property
    def is_local(self) -> bool:
        return self.env == "local"

    @property
    def dev_sim_allowed(self) -> bool:
        return self.is_local and self.dev_payment_simulation and self.lightning_mock_enabled


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()


def world_bounds() -> tuple[float, float, float, float]:
    """Playable (scaled) world rectangle: xmin, xmax, zmin, zmax."""
    xmin, xmax, zmin, zmax = settings.world_raw_bounds
    k = settings.world_scale
    return xmin * k, xmax * k, zmin * k, zmax * k
