"""LND REST adapter for a node on a test network (testnet / signet /
regtest), e.g. your own LND, Polar, or a hosted testnet node.

Credentials stay on the server: an INVOICE macaroon (create + read
invoices, nothing that can spend) and the node's TLS certificate. The node
picks the preimage; the game stores the payment hash the node returns.
Every invoice is checked (network prefix + exact amount) before use, and
the node's own network must match KK_LIGHTNING_NETWORK.
"""

from __future__ import annotations

import base64
from datetime import datetime, timezone
from typing import Any

import httpx

from app.core.config import settings
from app.payments.bolt11 import TEST_NETWORKS, check_invoice
from app.payments.interfaces import Invoice, InvoiceRequest, LightningAdapter, LightningAdapterError, SettlementEvent


def _ts(v: Any) -> datetime | None:
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return datetime.fromtimestamp(n, tz=timezone.utc) if n > 0 else None


class LndRestAdapter(LightningAdapter):
    provider = "lnd"

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        if settings.lightning_network not in TEST_NETWORKS:
            raise LightningAdapterError("mainnet_disabled")
        if not settings.lnd_rest_url or not settings.lnd_macaroon_hex:
            raise LightningAdapterError("lnd_not_configured")
        self.base = settings.lnd_rest_url.rstrip("/")
        self.network = settings.lightning_network
        self._transport = transport
        self._verify: Any = settings.lnd_tls_cert_path or True
        self._network_checked = False

    async def _call(self, method: str, path: str, body: dict | None = None) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=10.0, verify=self._verify, transport=self._transport) as c:
                r = await c.request(method, self.base + path, json=body, headers={"Grpc-Metadata-macaroon": settings.lnd_macaroon_hex})
        except httpx.HTTPError as exc:
            raise LightningAdapterError(f"lnd_unreachable: {type(exc).__name__}") from exc
        if r.status_code == 404:
            raise LightningAdapterError("unknown_invoice")
        if r.status_code >= 400:
            raise LightningAdapterError(f"lnd_error_{r.status_code}")
        return r.json()

    async def _check_network(self) -> dict[str, Any]:
        info = await self._call("GET", "/v1/getinfo")
        chains = info.get("chains") or []
        nets = {c.get("network") for c in chains if c.get("chain", "bitcoin") == "bitcoin"}
        if self.network not in nets:
            raise LightningAdapterError(f"node_network_mismatch_{'_'.join(sorted(n for n in nets if n)) or 'unknown'}")
        self._network_checked = True
        return info

    async def create_invoice(self, request: InvoiceRequest) -> Invoice:
        if request.amount_sats <= 0:
            raise LightningAdapterError("amount_must_be_positive")
        if not self._network_checked:
            await self._check_network()
        data = await self._call("POST", "/v1/invoices", {"value": str(request.amount_sats), "memo": request.memo[:600], "expiry": str(request.expiry_seconds)})
        bolt11 = data.get("payment_request") or ""
        check_invoice(bolt11, self.network, request.amount_sats)
        payment_hash = base64.b64decode(data["r_hash"]).hex()
        now = datetime.now(timezone.utc)
        return Invoice(
            provider=self.provider,
            provider_invoice_id=str(data.get("add_index") or payment_hash),
            payment_hash=payment_hash,
            bolt11=bolt11,
            amount_sats=request.amount_sats,
            memo=request.memo,
            status="awaiting_payment",
            expires_at=datetime.fromtimestamp(now.timestamp() + request.expiry_seconds, tz=timezone.utc),
            raw={"add_index": data.get("add_index")},
        )

    async def get_invoice_status(self, payment_hash: str) -> Invoice:
        d = await self._call("GET", f"/v1/invoice/{payment_hash}")
        state = d.get("state", "OPEN")
        status = {"SETTLED": "settled", "CANCELED": "expired", "OPEN": "awaiting_payment", "ACCEPTED": "awaiting_payment"}.get(state, "awaiting_payment")
        created = _ts(d.get("creation_date"))
        expires = datetime.fromtimestamp(created.timestamp() + int(d.get("expiry") or 0), tz=timezone.utc) if created else None
        return Invoice(
            provider=self.provider,
            provider_invoice_id=str(d.get("add_index") or payment_hash),
            payment_hash=payment_hash,
            bolt11=d.get("payment_request", ""),
            amount_sats=int(d.get("value") or 0),
            memo=d.get("memo", ""),
            status=status,
            expires_at=expires,
            settled_at=_ts(d.get("settle_date")),
            raw={"amt_paid_sat": int(d.get("amt_paid_sat") or 0), "state": state},
        )

    async def validate_settlement_event(self, event: SettlementEvent) -> bool:
        try:
            inv = await self.get_invoice_status(event.payment_hash)
        except LightningAdapterError:
            return False
        paid = inv.raw.get("amt_paid_sat", 0)
        return inv.status == "settled" and event.amount_paid_sats == inv.amount_sats and paid >= inv.amount_sats

    async def get_node_health(self) -> dict[str, Any]:
        try:
            info = await self._check_network()
        except LightningAdapterError as exc:
            return {"provider": self.provider, "network": self.network, "ready": False, "error": str(exc)}
        return {
            "provider": self.provider,
            "network": self.network,
            "ready": bool(info.get("synced_to_chain")) and int(info.get("num_active_channels") or 0) > 0,
            "synced": bool(info.get("synced_to_chain")),
            "active_channels": int(info.get("num_active_channels") or 0),
            "alias": info.get("alias", ""),
        }

    async def reconcile_pending_invoices(self, payment_hashes: list[str]) -> list[SettlementEvent]:
        out: list[SettlementEvent] = []
        for h in payment_hashes:
            try:
                inv = await self.get_invoice_status(h)
            except LightningAdapterError:
                continue
            if inv.status == "settled":
                out.append(SettlementEvent(
                    provider_event_id=f"lnd-settle-{h}",
                    payment_hash=h,
                    bolt11=inv.bolt11,
                    amount_paid_sats=inv.raw.get("amt_paid_sat", 0),
                    settled_at=inv.settled_at or datetime.now(timezone.utc),
                    raw={"source": "lnd_poll"},
                ))
        return out
