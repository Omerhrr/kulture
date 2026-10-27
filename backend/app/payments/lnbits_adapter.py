"""LNbits adapter: a wallet on an LNbits instance whose funding source is a
test-network node (testnet / signet / regtest).

Only the wallet's INVOICE / read key is used (it can create and check
invoices, never spend). LNbits does not report its network, so every
invoice it returns is checked: network prefix (lntb / lntbs / lnbcrt) and
the exact amount. A mainnet-funded LNbits is refused on its first invoice.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

from app.core.config import settings
from app.payments.bolt11 import TEST_NETWORKS, check_invoice
from app.payments.interfaces import Invoice, InvoiceRequest, LightningAdapter, LightningAdapterError, SettlementEvent


class LnbitsAdapter(LightningAdapter):
    provider = "lnbits"

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        if settings.lightning_network not in TEST_NETWORKS:
            raise LightningAdapterError("mainnet_disabled")
        if not settings.lnbits_url or not settings.lnbits_invoice_key:
            raise LightningAdapterError("lnbits_not_configured")
        self.base = settings.lnbits_url.rstrip("/")
        self.network = settings.lightning_network
        self._transport = transport

    async def _call(self, method: str, path: str, body: dict | None = None) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=10.0, transport=self._transport) as c:
                r = await c.request(method, self.base + path, json=body, headers={"X-Api-Key": settings.lnbits_invoice_key})
        except httpx.HTTPError as exc:
            raise LightningAdapterError(f"lnbits_unreachable: {type(exc).__name__}") from exc
        if r.status_code == 404:
            raise LightningAdapterError("unknown_invoice")
        if r.status_code >= 400:
            raise LightningAdapterError(f"lnbits_error_{r.status_code}")
        return r.json()

    async def create_invoice(self, request: InvoiceRequest) -> Invoice:
        if request.amount_sats <= 0:
            raise LightningAdapterError("amount_must_be_positive")
        d = await self._call("POST", "/api/v1/payments", {"out": False, "amount": request.amount_sats, "memo": request.memo[:600], "expiry": request.expiry_seconds})
        bolt11 = d.get("bolt11") or d.get("payment_request") or ""
        check_invoice(bolt11, self.network, request.amount_sats)
        payment_hash = d["payment_hash"]
        now = datetime.now(timezone.utc)
        return Invoice(
            provider=self.provider,
            provider_invoice_id=d.get("checking_id") or payment_hash,
            payment_hash=payment_hash,
            bolt11=bolt11,
            amount_sats=request.amount_sats,
            memo=request.memo,
            status="awaiting_payment",
            expires_at=datetime.fromtimestamp(now.timestamp() + request.expiry_seconds, tz=timezone.utc),
        )

    async def get_invoice_status(self, payment_hash: str) -> Invoice:
        d = await self._call("GET", f"/api/v1/payments/{payment_hash}")
        det = d.get("details") or {}
        paid = bool(d.get("paid"))
        amount_msat = abs(int(det.get("amount") or 0))
        settled_at = None
        if paid:
            t = det.get("time")
            try:
                settled_at = datetime.fromtimestamp(int(t), tz=timezone.utc) if isinstance(t, (int, float)) or str(t).isdigit() else datetime.fromisoformat(str(t))
            except (TypeError, ValueError):
                settled_at = datetime.now(timezone.utc)
        expired = not paid and str(det.get("status", "")).lower() in ("failed", "expired")
        return Invoice(
            provider=self.provider,
            provider_invoice_id=det.get("checking_id") or payment_hash,
            payment_hash=payment_hash,
            bolt11=det.get("bolt11", ""),
            amount_sats=amount_msat // 1000,
            memo=det.get("memo", ""),
            status="settled" if paid else "expired" if expired else "awaiting_payment",
            settled_at=settled_at,
            raw={"amt_paid_sat": amount_msat // 1000 if paid else 0},
        )

    async def validate_settlement_event(self, event: SettlementEvent) -> bool:
        try:
            inv = await self.get_invoice_status(event.payment_hash)
        except LightningAdapterError:
            return False
        return inv.status == "settled" and inv.amount_sats == event.amount_paid_sats

    async def get_node_health(self) -> dict[str, Any]:
        try:
            w = await self._call("GET", "/api/v1/wallet")
        except LightningAdapterError as exc:
            return {"provider": self.provider, "network": self.network, "ready": False, "error": str(exc)}
        return {"provider": self.provider, "network": self.network, "ready": True, "wallet": w.get("name", "")}

    async def reconcile_pending_invoices(self, payment_hashes: list[str]) -> list[SettlementEvent]:
        out: list[SettlementEvent] = []
        for h in payment_hashes:
            try:
                inv = await self.get_invoice_status(h)
            except LightningAdapterError:
                continue
            if inv.status == "settled":
                out.append(SettlementEvent(
                    provider_event_id=f"lnbits-settle-{h}",
                    payment_hash=h,
                    bolt11=inv.bolt11 or None,
                    amount_paid_sats=inv.amount_sats,
                    settled_at=inv.settled_at or datetime.now(timezone.utc),
                    raw={"source": "lnbits_poll"},
                ))
        return out
