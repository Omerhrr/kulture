"""Business models: businesses, shop listings, and NPC agent registrations."""

from __future__ import annotations

from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import Timestamped, UUIDPk
from app.models.catalog import Item  # noqa: F401  (ShopListing.item relationship target)


class Business(UUIDPk, Timestamped, Base):
    __tablename__ = "businesses"

    code: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    owner_type: Mapped[str] = mapped_column(String(16), nullable=False)  # npc | player | system
    owner_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    business_type: Mapped[str] = mapped_column(String(32), nullable=False)  # shop | pos | transport
    entity_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("world_entities.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(32), default="open", nullable=False)
    # status: open | closed | power_outage
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    listings: Mapped[list["ShopListing"]] = relationship(
        back_populates="business", lazy="joined"
    )


class ShopListing(UUIDPk, Base):
    __tablename__ = "shop_listings"
    __table_args__ = (
        UniqueConstraint("business_id", "item_id", name="uq_listing_business_item"),
    )

    business_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("businesses.id", ondelete="CASCADE"), index=True, nullable=False
    )
    item_id: Mapped[str] = mapped_column(String(36), ForeignKey("items.id"), nullable=False)
    quantity_available: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    price_ksats: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    price_sats: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    business: Mapped[Business] = relationship(back_populates="listings")
    item: Mapped[Item] = relationship(lazy="joined")


class NPCAgent(UUIDPk, Timestamped, Base):
    __tablename__ = "npc_agents"

    code: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    persona: Mapped[str] = mapped_column(String(2048), default="")
    world_entity_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("world_entities.id", ondelete="CASCADE"), nullable=False
    )
    business_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("businesses.id", ondelete="SET NULL"), nullable=True
    )
    agent_type: Mapped[str] = mapped_column(String(32), default="shopkeeper", nullable=False)
    allowed_tools: Mapped[list[str]] = mapped_column(JSON, default=list)
    configuration: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
