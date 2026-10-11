"""Kaduna Kulture backend — application configuration.

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
    # Database — SQLite (aiosqlite) for local dev, PostgreSQL for
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
    interaction_radius: float = 6.0          # world units
    movement_rate_limit_hz: float = 20.0     # WS movement messages per second
    job_reward_currency: str = "ngn_minor"

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
