"""Main story progress: one row per player (see services/story_service)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.base import Timestamped


class StoryProgress(Timestamped, Base):
    __tablename__ = "story_progress"

    player_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    # index into story_service.CHAPTERS; == len(CHAPTERS) when the story is done
    chapter: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    # the current chapter has been given (you talked to its giver)
    started: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    # the per-player delivery job of the current chapter, if it has one
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # finished chapters: [{"key": ..., "at": iso}]
    log: Mapped[list[Any]] = mapped_column(JSON, default=list)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
