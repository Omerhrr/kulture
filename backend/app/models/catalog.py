"""Catalog models: items and player inventories (optimistic concurrency)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, String, UniqueConstraint, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import Timestamped, UUIDPk


class Item(UUIDPk, Timestamped, Base):
    __tablename__ = "items"

    code: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    item_type: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    # item_type: food | fashion | electronics | quest | misc
    description: Mapped[str] = mapped_column(String(512), default="")
    emoji: Mapped[str] = mapped_column(String(16), default="\U0001f4e6")
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class Inventory(UUIDPk, Base):
    __tablename__ = "inventories"
    __table_args__ = (
        UniqueConstraint("player_id", "item_id", name="uq_inventory_player_item"),
    )

    player_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("player_profiles.id", ondelete="CASCADE"), index=True, nullable=False
    )
    item_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("items.id"), nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    item: Mapped[Item] = relationship(lazy="joined")
