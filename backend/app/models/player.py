"""Identity and player models: users, player_profiles, player_states."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Timestamped, UUIDPk, utcnow
from app.db.session import Base


class User(UUIDPk, Timestamped, Base):
    __tablename__ = "users"

    username: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    profile: Mapped["PlayerProfile | None"] = relationship(
        back_populates="user", uselist=False, lazy="joined"
    )


class PlayerProfile(UUIDPk, Timestamped, Base):
    __tablename__ = "player_profiles"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    display_name: Mapped[str] = mapped_column(String(64), nullable=False)
    avatar_id: Mapped[str] = mapped_column(String(64), default="danfo_rider", nullable=False)
    reputation: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    user: Mapped[User] = relationship(back_populates="profile")


class PlayerState(UUIDPk, Base):
    """Authoritative player position + session state. The server owns this."""

    __tablename__ = "player_states"

    player_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("player_profiles.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    region_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("world_regions.id"), nullable=False
    )
    position_x: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    position_y: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)  # height
    position_z: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    facing: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    state_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    extra: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
