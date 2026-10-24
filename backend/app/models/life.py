"""A life that progresses: school, property, relationships, messages,
multiplayer phone games and street-race times."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Float, JSON, Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.base import Timestamped, UUIDPk


class LifeState(Timestamped, Base):
    """Status ladder: where you live, what you drive, what you own."""

    __tablename__ = "life_states"

    player_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    housing: Mapped[str] = mapped_column(String(16), default="family", nullable=False)  # family | rent | own
    rent_paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    car_tier: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # 0 none .. 3
    # your own car: paint, number plate and where you last parked it
    car_color: Mapped[str] = mapped_column(String(9), default="", server_default="", nullable=False)
    car_plate: Mapped[str] = mapped_column(String(12), default="", server_default="", nullable=False)
    car_region: Mapped[str | None] = mapped_column(String(32), nullable=True)
    car_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    car_z: Mapped[float | None] = mapped_column(Float, nullable=True)
    car_heading: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    business_kind: Mapped[str | None] = mapped_column(String(16), nullable=True)  # shop | restaurant
    business_name: Mapped[str | None] = mapped_column(String(48), nullable=True)
    business_collected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    business_sales: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # running the business: shop (1) -> supermarket (2) -> mall (3)
    business_level: Mapped[int] = mapped_column(Integer, default=1, nullable=False, server_default="1")
    business_stock: Mapped[int] = mapped_column(Integer, default=60, nullable=False, server_default="60")
    business_price_pct: Mapped[int] = mapped_column(Integer, default=100, nullable=False, server_default="100")
    business_staff: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")
    # health & fitness
    health: Mapped[int] = mapped_column(Integer, default=90, nullable=False, server_default="90")
    fitness: Mapped[int] = mapped_column(Integer, default=10, nullable=False, server_default="10")
    sick: Mapped[str | None] = mapped_column(String(32), nullable=True)
    health_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # politics (fictional, non-partisan ward elections)
    office: Mapped[str | None] = mapped_column(String(32), nullable=True)
    campaign_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    campaign_support: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")
    campaign_rival: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")


class Enrollment(UUIDPk, Timestamped, Base):
    __tablename__ = "enrollments"

    player_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    school: Mapped[str] = mapped_column(String(16), nullable=False)  # kadpoly | kasu
    course: Mapped[str] = mapped_column(String(32), nullable=False)
    lectures_done: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    exam_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    certified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # the questions currently in front of you (ids), graded server side
    pending: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class Relationship(UUIDPk, Timestamped, Base):
    __tablename__ = "relationships"

    player_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    other_kind: Mapped[str] = mapped_column(String(8), nullable=False)  # npc | player
    other_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    friendship: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # 0..100
    romance: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # 0..100
    status: Mapped[str] = mapped_column(String(16), default="acquaintance", nullable=False)
    memory: Mapped[list[Any]] = mapped_column(JSON, default=list)  # short notes NPCs remember
    date_state: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class DirectMessage(UUIDPk, Timestamped, Base):
    __tablename__ = "direct_messages"

    from_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    to_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class GameMatch(UUIDPk, Timestamped, Base):
    __tablename__ = "game_matches"

    game: Mapped[str] = mapped_column(String(16), nullable=False, index=True)  # whot | ludo | ayo | trivia
    status: Mapped[str] = mapped_column(String(12), default="waiting", nullable=False, index=True)
    stake: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # per player, minor units
    asset: Mapped[str] = mapped_column(String(12), default="ksats", nullable=False)
    players: Mapped[list[Any]] = mapped_column(JSON, default=list)  # [{id, name, bot}]
    state: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    winner: Mapped[str | None] = mapped_column(String(36), nullable=True)
    seq: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class RaceTime(UUIDPk, Timestamped, Base):
    __tablename__ = "race_times"

    player_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    route: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    ms: Mapped[int] = mapped_column(Integer, nullable=False)


class ArcadeScore(UUIDPk, Timestamped, Base):
    """Phone arcade high scores (snake, platformer, fighters...)."""

    __tablename__ = "arcade_scores"

    player_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    game: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    score: Mapped[int] = mapped_column(Integer, nullable=False)


class Child(UUIDPk, Timestamped, Base):
    """A child in your household (after marriage)."""

    __tablename__ = "children"

    player_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(48), nullable=False)
    gender: Mapped[str] = mapped_column(String(8), nullable=False)
    hunger: Mapped[int] = mapped_column(Integer, default=80, nullable=False)  # 100 = full
    happiness: Mapped[int] = mapped_column(Integer, default=80, nullable=False)
    schooling: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    cared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Crew(UUIDPk, Timestamped, Base):
    """A players' club: group chat, night-race turf, clubhouse."""

    __tablename__ = "crews"

    name: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    tag: Mapped[str] = mapped_column(String(5), nullable=False)
    color: Mapped[str] = mapped_column(String(9), default="#e0a020", nullable=False)
    owner_id: Mapped[str] = mapped_column(String(36), nullable=False)


class CrewMember(UUIDPk, Timestamped, Base):
    __tablename__ = "crew_members"

    crew_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    player_id: Mapped[str] = mapped_column(String(36), nullable=False, unique=True)
    role: Mapped[str] = mapped_column(String(12), default="member", nullable=False)


class CrewMessage(UUIDPk, Timestamped, Base):
    __tablename__ = "crew_messages"

    crew_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    from_id: Mapped[str] = mapped_column(String(36), nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
