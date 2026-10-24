"""Workplace shifts: clock in at the workplace, stay, get paid once."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.base import Timestamped, UUIDPk, utcnow


class WorkShift(UUIDPk, Timestamped, Base):
    __tablename__ = "work_shifts"
    __table_args__ = (Index("ix_shift_player_status", "player_id", "status"),)

    player_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    career: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)
    # active | paid | left_early
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    tasks_done: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    paid_ksats: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
