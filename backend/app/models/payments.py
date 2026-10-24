"""Payment models: intents, Lightning invoices, and durable settlement events.

Integrity rules encoded here:
- ``payment_intents.idempotency_key`` is UNIQUE (replay protection).
- ``lightning_invoices.payment_hash`` is UNIQUE per provider (one invoice = one hash).
- ``payment_events.provider_event_id`` is UNIQUE (idempotent event processing).
- Amounts are always integer minor units (sats / kobo).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, BigInteger, DateTime, ForeignKey, String, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import Timestamped, UUIDPk, utcnow


class PaymentIntent(UUIDPk, Timestamped, Base):
    __tablename__ = "payment_intents"
    __table_args__ = (
        Index("ix_payment_intents_status", "status"),
    )

    player_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("player_profiles.id", ondelete="CASCADE"), index=True, nullable=False
    )
    business_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("businesses.id", ondelete="SET NULL"), nullable=True
    )
    listing_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("shop_listings.id", ondelete="SET NULL"), nullable=True
    )
    # A deposit intent has no item; purchases always name the item bought.
    item_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("items.id"), nullable=True)
    quantity: Mapped[int] = mapped_column(default=1, nullable=False)
    amount_sats: Mapped[int] = mapped_column(BigInteger, nullable=False)
    amount_ksats: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), default="sats", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="created", nullable=False)
    # created -> invoice_pending -> awaiting_payment -> settled | expired | failed | cancelled | reconciliation_required
    # (explicitly indexed via __table_args__ ix_payment_intents_status)
    purchase_reference: Mapped[str] = mapped_column(String(128), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    fulfilled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    invoices: Mapped[list["LightningInvoice"]] = relationship(back_populates="intent")


class LightningInvoice(UUIDPk, Base):
    __tablename__ = "lightning_invoices"

    payment_intent_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("payment_intents.id", ondelete="CASCADE"), index=True, nullable=False
    )
    provider: Mapped[str] = mapped_column(String(32), nullable=False)  # mock | ldk_node
    provider_invoice_id: Mapped[str] = mapped_column(String(256), nullable=False)
    payment_hash: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    invoice_bolt11: Mapped[str] = mapped_column(String(1024), nullable=False)
    amount_sats: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="created", nullable=False, index=True)
    # created | awaiting_payment | settled | expired | failed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    memo: Mapped[str] = mapped_column(String(256), default="", nullable=False)

    intent: Mapped[PaymentIntent] = relationship(back_populates="invoices")


class PaymentEvent(UUIDPk, Base):
    """Durable, append-only settlement/reconciliation event log."""

    __tablename__ = "payment_events"
    __table_args__ = (
        Index("ix_payment_events_invoice", "invoice_id"),
    )

    provider_event_id: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    invoice_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("lightning_invoices.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(48), nullable=False)
    # invoice.created | invoice.settled | invoice.expired | reconciliation.marked | invoice.recovered
    payload_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
