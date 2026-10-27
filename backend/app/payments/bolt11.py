"""Just enough BOLT11 to keep the game on a test network: which network an
invoice belongs to (its human-readable prefix) and the amount it asks for.

The game only ever handles test-network sats (testnet / signet / regtest).
A node that hands back a mainnet invoice, or an invoice for a different
amount than the one authorised, is refused before anyone sees a QR code.
"""

from __future__ import annotations

from decimal import Decimal

from app.payments.interfaces import LightningAdapterError

# longest first: lnbcrt and lntbs start like lnbc / lntb
PREFIXES = [("lnbcrt", "regtest"), ("lntbs", "signet"), ("lntb", "testnet"), ("lnsb", "simnet"), ("lnbc", "mainnet")]
TEST_NETWORKS = {"testnet", "signet", "regtest"}
_MULT = {"m": Decimal("0.001"), "u": Decimal("0.000001"), "n": Decimal("0.000000001"), "p": Decimal("0.000000000001")}


def _hrp(bolt11: str) -> str:
    s = bolt11.strip().lower()
    if s.startswith("lightning:"):
        s = s[len("lightning:"):]
    if "1" not in s:
        raise LightningAdapterError("invoice_malformed")
    return s[: s.rindex("1")]


def network_of(bolt11: str) -> str:
    hrp = _hrp(bolt11)
    for prefix, net in PREFIXES:
        if hrp.startswith(prefix):
            return net
    raise LightningAdapterError("invoice_unknown_network")


def amount_sats_of(bolt11: str) -> int | None:
    """Amount in sats, or None for an any-amount invoice."""
    hrp = _hrp(bolt11)
    for prefix, _ in PREFIXES:
        if hrp.startswith(prefix):
            amt = hrp[len(prefix):]
            break
    else:
        raise LightningAdapterError("invoice_unknown_network")
    if not amt:
        return None
    mult = _MULT.get(amt[-1])
    digits = amt[:-1] if mult else amt
    if not digits.isdigit():
        raise LightningAdapterError("invoice_bad_amount")
    btc = Decimal(digits) * (mult or 1)
    sats = btc * 100_000_000
    if sats != sats.to_integral_value():
        # sub-sat (msat) amounts: never what the game asks for
        raise LightningAdapterError("invoice_bad_amount")
    return int(sats)


def check_invoice(bolt11: str, network: str, amount_sats: int) -> None:
    """Refuse anything that isn't exactly the test-network invoice we asked for."""
    if network not in TEST_NETWORKS:
        raise LightningAdapterError("mainnet_disabled")
    got = network_of(bolt11)
    if got != network:
        raise LightningAdapterError(f"invoice_wrong_network_{got}")
    amt = amount_sats_of(bolt11)
    if amt != amount_sats:
        raise LightningAdapterError("invoice_amount_mismatch")
