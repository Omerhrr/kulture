"""World models: regions and interactive entities (buildings, kiosks, landmarks)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import Timestamped, UUIDPk


class WorldRegion(UUIDPk, Timestamped, Base):
    __tablename__ = "world_regions"

    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    slug: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(String(512), default="")
    map_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    entities: Mapped[list["WorldEntity"]] = relationship(back_populates="region")


class WorldEntity(UUIDPk, Timestamped, Base):
    __tablename__ = "world_entities"

    region_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("world_regions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    # entity_type: shop | pos_kiosk | market | landmark | transport_stop | spawn | npc
    position_x: Mapped[float] = mapped_column(Float, nullable=False)
    position_y: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    position_z: Mapped[float] = mapped_column(Float, nullable=False)
    rotation: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    interaction_radius: Mapped[float] = mapped_column(Float, default=6.0, nullable=False)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)

    region: Mapped[WorldRegion] = relationship(back_populates="entities")
