"""A player's character: chosen look and name; the life the game gave them
(background, dream, neighbourhood and home). See services/character_service."""

from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, Float, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.base import Timestamped


class Character(Timestamped, Base):
    __tablename__ = "characters"

    player_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(32), nullable=False)
    look: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    # assigned by the game, never chosen
    birth: Mapped[str] = mapped_column(String(16), nullable=False)  # nepo | middle | hustle
    dream: Mapped[str] = mapped_column(String(16), nullable=False)
    home_area: Mapped[str] = mapped_column(String(32), nullable=False)
    home_x: Mapped[float] = mapped_column(Float, nullable=False)
    home_z: Mapped[float] = mapped_column(Float, nullable=False)
