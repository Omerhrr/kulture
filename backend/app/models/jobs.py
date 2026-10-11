"""Jobs: available and completed game missions (delivery etc.)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, BigInteger, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.base import Timestamped, UUIDPk, utcnow


class Job(UUIDPk, Timestamped, Base):
    __tablename__ = "jobs"

    code: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    job_type: Mapped[str] = mapped_column(String(32), index=True, nullable=False)  # delivery
    title: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str] = mapped_column(String(512), default="")
    issuer_business_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("businesses.id", ondelete="SET NULL"), nullable=True
    )
    assignee_player_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("player_profiles.id", ondelete="SET NULL"), index=True, nullable=True
    )
    status: Mapped[str] = mapped_column(String(24), default="available", index=True, nullable=False)
    # status: available | assigned | in_progress | completed | expired
    pickup_entity_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("world_entities.id"), nullable=False
    )
    dropoff_entity_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("world_entities.id"), nullable=False
    )
    pickup_state: Mapped[str] = mapped_column(String(24), default="pending", nullable=False)
    # pickup_state: pending | picked_up | delivered
    reward_ngn_minor: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    reward_reputation: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
