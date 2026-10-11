"""LDK Node adapter — integration point for a real Lightning node.

Implement this class against the current ``ldk-node`` Python bindings
(verifying binding support is a spec-mandated prerequisite — see
docs/lightning-integration.md for the verified integration checklist,
lifecycle rules, and regtest bring-up guide). The adapter is intentionally
kept node-specific: gameplay services only ever talk to LightningAdapter.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import httpx

from app.core.config import settings
from app.payments.interfaces import (
    Invoice,
    InvoiceRequest,
    LightningAdapter,
    LightningAdapterError,
    SettlementEvent,
)


class LdkNodeAdapter(LightningAdapter):
    """Minimal REST-oriented adapter sketch for an LDK Node sidecar
    (e.g. ldk-node with its builtin RPC/server, or a small companion service).

    TODO(production): replace sketch calls with the verified binding API,
    add strict timeouts, retries with jitter, and webhook verification.
    """

    provider = "ldk_node"

    def __init__(self) -> None:
        self.base_url = settings.ldk_node_url.rstrip("/")
        self.api_key = settings.ldk_node_api_key

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}

    async def _call(self, method: str, path: str, json_body: dict | None = None) -> Any:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.request(
                    method, f"{self.base_url}{path}", json=json_body, headers=self._headers()
                )
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPError as exc:
            raise LightningAdapterError(f"ldk_node_unreachable: {exc}") from exc

    async def create_invoice(self, request: InvoiceRequest) -> Invoice:
        data = await self._call(
            "POST",
            "/v1/invoice",
            {
                "amount_msat": request.amount_sats * 1000,
                "description": request.memo,
                "expiry_secs": request.expiry_seconds,
            },
        )
        return Invoice(
            provider=self.provider,
            provider_invoice_id=data.get("id", uuid.uuid4().hex),
            payment_hash=data["payment_hash"],
            bolt11=data["bolt11"],
            amount_sats=request.amount_sats,
            memo=request.memo,
            status="awaiting_payment",
            expires_at=datetime.fromtimestamp(
                int(datetime.now(timezone.utc).timestamp()) + request.expiry_seconds,
                tz=timezone.utc,
            ),
            raw=data,
        )

    async def get_invoice_status(self, payment_hash: str) -> Invoice:
        data = await self._call("GET", f"/v1/invoice/{payment_hash}")
        return Invoice(
            provider=self.provider,
            provider_invoice_id=data.get("id", payment_hash),
            payment_hash=payment_hash,
            bolt11=data.get("bolt11", ""),
            amount_sats=int(data.get("amount_sat", 0)),
            memo=data.get("description", ""),
            status="settled" if data.get("is_paid") else "awaiting_payment",
            settled_at=(
                datetime.fromtimestamp(int(data["paid_at"]), tz=timezone.utc)
                if data.get("paid_at") else None
            ),
            raw=data,
        )

    async def validate_settlement_event(self, event: SettlementEvent) -> bool:
        try:
            inv = await self.get_invoice_status(event.payment_hash)
        except LightningAdapterError:
            return False
        return inv.status == "settled" and inv.amount_sats == event.amount_paid_sats

    async def get_node_health(self) -> dict[str, Any]:
        try:
            data = await self._call("GET", "/v1/status")
            return {"provider": self.provider, "healthy": True, "raw": data}
        except LightningAdapterError as exc:
            return {"provider": self.provider, "healthy": False, "error": str(exc)}

    async def reconcile_pending_invoices(self, payment_hashes: list[str]) -> list[SettlementEvent]:
        events: list[SettlementEvent] = []
        for h in payment_hashes:
            try:
                inv = await self.get_invoice_status(h)
            except LightningAdapterError:
                continue
            if inv.status == "settled" and inv.settled_at:
                events.append(
                    SettlementEvent(
                        provider_event_id=f"ldk-reconcile-{h[:24]}-{int(inv.settled_at.timestamp())}",
                        payment_hash=h,
                        bolt11=inv.bolt11,
                        amount_paid_sats=inv.amount_sats,
                        settled_at=inv.settled_at,
                        raw={"source": "reconciliation"},
                    )
                )
        return events
