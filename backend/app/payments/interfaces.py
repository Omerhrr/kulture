"""Lightning adapter interface — the ONLY boundary between the game and any
Lightning implementation (LDK Node today, others tomorrow).

Rules (from the spec):
- Node-specific code must never leak into gameplay services.
- An invoice is a payment REQUEST, not proof of payment.
- Settlement is verified by the adapter against the node, never by the client.
- Timeouts are unknown outcomes until reconciled.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(slots=True)
class InvoiceRequest:
    amount_sats: int
    memo: str
    expiry_seconds: int
    payment_hash: str  # pre-computed by the app so intent↔invoice association is provable


@dataclass(slots=True)
class Invoice:
    provider: str
    provider_invoice_id: str
    payment_hash: str
    bolt11: str
    amount_sats: int
    memo: str
    status: str  # created | awaiting_payment | settled | expired | failed
    expires_at: datetime | None = None
    settled_at: datetime | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class SettlementEvent:
    """Authoritative settlement notification (from node webhook, poll, or
    reconciliation). ``provider_event_id`` must be unique per occurrence."""

    provider_event_id: str
    payment_hash: str
    bolt11: str | None
    amount_paid_sats: int
    settled_at: datetime
    raw: dict[str, Any] = field(default_factory=dict)


class LightningAdapterError(Exception):
    """Adapter-level failure (node down, timeout, malformed response)."""


class LightningAdapter(ABC):
    provider: str = "abstract"

    @abstractmethod
    async def create_invoice(self, request: InvoiceRequest) -> Invoice:
        """Create a BOLT11 invoice for the exact authorized amount."""

    @abstractmethod
    async def get_invoice_status(self, payment_hash: str) -> Invoice:
        """Poll the node for authoritative invoice state."""

    @abstractmethod
    async def validate_settlement_event(self, event: SettlementEvent) -> bool:
        """Independently verify a settlement claim against node state."""

    @abstractmethod
    async def get_node_health(self) -> dict[str, Any]:
        """Node readiness summary for the health endpoint."""

    @abstractmethod
    async def reconcile_pending_invoices(self, payment_hashes: list[str]) -> list[SettlementEvent]:
        """Return authoritative settlement events for the given hashes (if any)."""
