"""Furniture a player owns in their home, and where it stands."""

from __future__ import annotations

from sqlalchemy import Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.base import Timestamped, UUIDPk


class HomeItem(UUIDPk, Timestamped, Base):
    __tablename__ = "home_items"

    player_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    sku: Mapped[str] = mapped_column(String(32), nullable=False)
    x: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    z: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    rot: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # quarter turns 0..3
