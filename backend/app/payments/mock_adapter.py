"""Mock regtest-style Lightning adapter.

Purpose: exercise the FULL payment state machine (invoice creation, expiry,
settlement events, idempotent fulfillment, reconciliation) without a running
bitcoind/LDK node. It produces structurally valid BOLT11 invoices (proper
bech32 encoding, regtest hrp ``lnbcrt``) so QR codes can be scanned and parsed
by real wallets — payment would only succeed on regtest, and only through the
dev-only simulation endpoint that emits settlement events through the exact
same idempotent pipeline a real node webhook would use.

Swap to a real node by setting KK_LIGHTNING_PROVIDER=ldk_node and implementing
LdkNodeAdapter (see docs/lightning-integration.md).
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from app.payments.interfaces import (
    Invoice,
    InvoiceRequest,
    LightningAdapter,
    LightningAdapterError,
    SettlementEvent,
)

# ---------------------------------------------------------------- bech32
_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"


def _bech32_polymod(values: list[int]) -> int:
    gen = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3]
    chk = 1
    for v in values:
        b = chk >> 25
        chk = (chk & 0x1FFFFFF) << 5 ^ v
        for i in range(5):
            chk ^= gen[i] if ((b >> i) & 1) else 0
    return chk


def _bech32_hrp_expand(hrp: str) -> list[int]:
    return [ord(x) >> 5 for x in hrp] + [0] + [ord(x) & 31 for x in hrp]


def bech32_encode(hrp: str, data: list[int]) -> str:
    values = _bech32_hrp_expand(hrp) + data
    polymod = _bech32_polymod(values + [0, 0, 0, 0, 0, 0]) ^ 1
    checksum = [(polymod >> 5 * (5 - i)) & 31 for i in range(6)]
    return hrp + "1" + "".join(_CHARSET[d] for d in data + checksum)


def _convertbits(data: bytes, frombits: int, tobits: int, pad: bool = True) -> list[int]:
    acc, bits, ret = 0, 0, []
    maxv = (1 << tobits) - 1
    for value in data:
        acc = (acc << frombits) | value
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            ret.append((acc >> bits) & maxv)
    if pad and bits:
        ret.append((acc << (tobits - bits)) & maxv)
    return ret


def _encode_tagged(tag: int, payload: bytes) -> list[int]:
    return [tag] + _convertbits(len(payload).to_bytes(2, "big"), 8, 5) + _convertbits(payload, 8, 5)


def build_bolt11(
    amount_sats: int, payment_hash: bytes, description: str, expiry_seconds: int, timestamp: int
) -> str:
    """Structurally valid lnbcrt invoice (fake signature — regtest simulator)."""
    hrp = "lnbcrt"
    # amount in millisatoshi -> pico-btc digits (bech32 amount field)
    msat = amount_sats * 1000
    amt = f"{msat:08d}".rstrip("0")  # 8 decimals = picocurrency precision
    hrp_full = hrp + (amt if amt else "")

    data: list[int] = []
    data += _convertbits(timestamp.to_bytes(7, "big"), 8, 5, pad=False)
    data += _encode_tagged(1, payment_hash)                      # payment_hash (256-bit)
    desc = description.encode("utf-8")[:639]
    data += _encode_tagged(13, desc)                             # description
    data += _encode_tagged(6, expiry_seconds.to_bytes(2, "big")) # expiry
    # signature: 64 pseudo-random bytes + recovery id 0 (regtest simulator)
    sig = secrets.token_bytes(64)
    data += _convertbits(sig + b"\x00", 8, 5)
    return bech32_encode(hrp_full, data)


class MockRegtestAdapter(LightningAdapter):
    provider = "mock"

    def __init__(self) -> None:
        # payment_hash -> simulated state (this IS the fake "node" state)
        self._invoices: dict[str, dict[str, Any]] = {}
        self._event_counter = 0

    async def create_invoice(self, request: InvoiceRequest) -> Invoice:
        if request.amount_sats <= 0:
            raise LightningAdapterError("amount_must_be_positive")
        ts = int(datetime.now(timezone.utc).timestamp())
        bolt11 = build_bolt11(
            request.amount_sats,
            bytes.fromhex(request.payment_hash),
            request.memo,
            request.expiry_seconds,
            ts,
        )
        expires = datetime.fromtimestamp(ts + request.expiry_seconds, tz=timezone.utc)
        provider_id = f"mock-{request.payment_hash[:16]}"
        self._invoices[request.payment_hash] = {
            "bolt11": bolt11,
            "amount_sats": request.amount_sats,
            "status": "awaiting_payment",
            "expires_at": expires,
            "provider_id": provider_id,
            "memo": request.memo,
            "created_ts": ts,
        }
        return Invoice(
            provider=self.provider,
            provider_invoice_id=provider_id,
            payment_hash=request.payment_hash,
            bolt11=bolt11,
            amount_sats=request.amount_sats,
            memo=request.memo,
            status="awaiting_payment",
            expires_at=expires,
            raw={},
        )

    async def get_invoice_status(self, payment_hash: str) -> Invoice:
        inv = self._invoices.get(payment_hash)
        if not inv:
            raise LightningAdapterError("unknown_invoice")
        return self._to_invoice(payment_hash, inv)

    def simulate_external_payment(self, payment_hash: str) -> SettlementEvent:
        """DEV ONLY: emulate an external wallet paying this invoice on regtest.
        Emits a settlement event that flows through the same idempotent
        processing pipeline as a real node webhook."""
        inv = self._invoices.get(payment_hash)
        if not inv:
            raise LightningAdapterError("unknown_invoice")
        if inv["status"] == "settled":
            raise LightningAdapterError("already_settled")
        now = datetime.now(timezone.utc)
        if inv["expires_at"] and now > inv["expires_at"]:
            inv["status"] = "expired"
            raise LightningAdapterError("invoice_expired")
        self._event_counter += 1
        inv["status"] = "settled"
        inv["settled_at"] = now
        event_id = f"mock-settle-{payment_hash[:16]}-{self._event_counter:08d}"
        return SettlementEvent(
            provider_event_id=event_id,
            payment_hash=payment_hash,
            bolt11=inv["bolt11"],
            amount_paid_sats=inv["amount_sats"],
            settled_at=now,
            raw={"source": "dev_simulation"},
        )

    async def validate_settlement_event(self, event: SettlementEvent) -> bool:
        inv = self._invoices.get(event.payment_hash)
        if not inv or inv["status"] != "settled":
            return False
        return event.amount_paid_sats == inv["amount_sats"]

    async def get_node_health(self) -> dict[str, Any]:
        settled = sum(1 for i in self._invoices.values() if i["status"] == "settled")
        return {
            "provider": self.provider,
            "mode": "regtest_simulator",
            "healthy": True,
            "known_invoices": len(self._invoices),
            "settled_invoices": settled,
            "note": "Mock adapter — settlement is simulated for development only.",
        }

    async def reconcile_pending_invoices(self, payment_hashes: list[str]) -> list[SettlementEvent]:
        events: list[SettlementEvent] = []
        for h in payment_hashes:
            inv = self._invoices.get(h)
            if inv and inv["status"] == "settled" and inv.get("settled_at"):
                events.append(
                    SettlementEvent(
                        provider_event_id=f"mock-reconcile-{h[:16]}-{int(inv['settled_at'].timestamp())}",
                        payment_hash=h,
                        bolt11=inv["bolt11"],
                        amount_paid_sats=inv["amount_sats"],
                        settled_at=inv["settled_at"],
                        raw={"source": "reconciliation"},
                    )
                )
        return events

    @staticmethod
    def _to_invoice(payment_hash: str, inv: dict[str, Any]) -> Invoice:
        return Invoice(
            provider="mock",
            provider_invoice_id=inv["provider_id"],
            payment_hash=payment_hash,
            bolt11=inv["bolt11"],
            amount_sats=inv["amount_sats"],
            memo=inv.get("memo", ""),
            status=inv["status"],
            expires_at=inv.get("expires_at"),
            settled_at=inv.get("settled_at"),
        )


_adapter: LightningAdapter | None = None


def get_adapter() -> LightningAdapter:
    global _adapter
    if _adapter is None:
        from app.core.config import settings

        if settings.lightning_provider == "ldk_node":
            from app.payments.ldk_node_adapter import LdkNodeAdapter

            _adapter = LdkNodeAdapter()
        else:
            _adapter = MockRegtestAdapter()
    return _adapter


def reset_adapter() -> None:
    global _adapter
    _adapter = None
