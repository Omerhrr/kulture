"""Transactional outbox: reliable delivery of domain events to async workers.

Events are committed in the same DB transaction as the state change that
produced them; a background worker polls and dispatches (WebSocket fanout,
agent triggers, reconciliation) with retry counting.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Integer, String, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.base import UUIDPk, utcnow


class OutboxEvent(UUIDPk, Base):
    __tablename__ = "outbox_events"
    __table_args__ = (Index("ix_outbox_status", "status"),)

    event_type: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    # player.state | job.updated | inventory.updated | payment.status | npc.dialogue
    # agent.action | world.event | agent.trigger
    aggregate_id: Mapped[str] = mapped_column(String(64), nullable=False)
    player_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(24), default="pending", nullable=False)
    # pending | processed | failed
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str] = mapped_column(String(256), default="")
