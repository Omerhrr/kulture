"""Billboard adverts bought with Lightning.

Lifecycle: awaiting_payment -> (settled) -> pending_review | live -> expired
                                         \\-> rejected (moderation)
The ad only goes on air after a VERIFIED Lightning settlement (hooked into
lightning_service.process_settlement, same transaction = exactly once) and,
unless KK_ADS_AUTO_APPROVE is on, after a moderator approves it.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.base import Timestamped, UUIDPk


class BillboardAd(UUIDPk, Timestamped, Base):
    __tablename__ = "billboard_ads"
    __table_args__ = (Index("ix_ads_board_status", "board_id", "status"),)

    player_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    board_id: Mapped[str] = mapped_column(String(16), nullable=False)
    brand: Mapped[str] = mapped_column(String(32), nullable=False)
    headline: Mapped[str] = mapped_column(String(60), nullable=False)
    subline: Mapped[str] = mapped_column(String(90), default="", nullable=False)
    cta: Mapped[str] = mapped_column(String(24), default="", nullable=False)
    url: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    theme: Mapped[str] = mapped_column(String(16), default="green", nullable=False)
    days: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    price_sats: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="awaiting_payment", nullable=False)
    intent_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[str] = mapped_column(String(200), default="", nullable=False)
