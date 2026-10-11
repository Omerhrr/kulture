"""Agent models: NPC agent runs and bounded tool actions (full audit trail)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Float, String, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import Timestamped, UUIDPk, utcnow


class AgentRun(UUIDPk, Timestamped, Base):
    __tablename__ = "agent_runs"
    __table_args__ = (Index("ix_agent_runs_agent", "agent_id"),)

    agent_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("npc_agents.id", ondelete="CASCADE"), nullable=False
    )
    trigger_source: Mapped[str] = mapped_column(String(48), nullable=False)
    # customer_interaction | inventory_threshold | job_event | scheduled_simulation | market_event
    trigger_event_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="running", nullable=False)
    # running | completed | failed | timeout | fallback
    engine: Mapped[str] = mapped_column(String(24), default="deterministic", nullable=False)
    # dsh_llm | deterministic_fallback
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    summary: Mapped[str] = mapped_column(String(512), default="")
    token_usage: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    actions: Mapped[list["AgentAction"]] = relationship(back_populates="run")


class AgentAction(UUIDPk, Timestamped, Base):
    __tablename__ = "agent_actions"
    __table_args__ = (Index("ix_agent_actions_run", "agent_run_id"),)

    agent_run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False
    )
    tool_name: Mapped[str] = mapped_column(String(64), nullable=False)
    input_payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    input_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    validation_status: Mapped[str] = mapped_column(String(24), default="pending", nullable=False)
    # pending | allowed | rejected_not_allowed | rejected_invalid_input | rejected_out_of_bounds
    execution_status: Mapped[str] = mapped_column(
        String(24), default="pending", nullable=False
    )
    # pending | executed | failed | skipped
    result_reference: Mapped[str] = mapped_column(String(160), default="")
    latency_ms: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    error: Mapped[str] = mapped_column(String(256), default="")

    run: Mapped[AgentRun] = relationship(back_populates="actions")
