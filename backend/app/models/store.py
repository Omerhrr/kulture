"""Player store shelves: what a player's shop sells, at their price."""

from __future__ import annotations

from sqlalchemy import BigInteger, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.base import Timestamped, UUIDPk


class ShelfItem(UUIDPk, Timestamped, Base):
    __tablename__ = "shelf_items"
    __table_args__ = (UniqueConstraint("owner_id", "item_id", name="uq_shelf_owner_item"),)

    owner_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    item_id: Mapped[str] = mapped_column(String(36), ForeignKey("items.id"), nullable=False)
    price_ksats: Mapped[int] = mapped_column(BigInteger, nullable=False)
    stock: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    sold: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
