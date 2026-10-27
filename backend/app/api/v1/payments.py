"""Payment routes: purchases, invoices, status, dev simulation, node health.

Security notes:
- Prices/amounts ALWAYS come from server-side listings; the client only
  sends listing_id + quantity + an idempotency key.
- The dev "simulate external wallet payment" endpoint is regtest/dev-only
  (guarded by settings.dev_sim_allowed) and emits a server-side settlement
  event through the exact same idempotent pipeline as a real node webhook.
- A client message is NEVER accepted as proof of Lightning settlement.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import error, get_current_profile
from app.core.config import settings
from app.db.session import get_db
from app.events.outbox_service import emit
from app.models.payments import LightningInvoice, PaymentIntent
from app.models.player import PlayerProfile
from app.payments.interfaces import SettlementEvent
from app.payments.lightning_service import (
    SATS_TO_KSATS,
    PaymentError,
    create_deposit_intent,
    check_with_node,
    create_invoice_for_intent,
    invoice_for_intent,
    mark_intent_cancelled,
    process_settlement,
)
from app.payments.mock_adapter import MockRegtestAdapter, get_adapter
from app.schemas.game import DevPayIn, PaymentIntentOut, PurchaseIn, DepositIn
from app.services import shop_service

router = APIRouter(tags=["payments"])


def _intent_out(intent: PaymentIntent, inv) -> PaymentIntentOut:
    return PaymentIntentOut(
        id=intent.id,
        status=intent.status,
        amount_sats=intent.amount_sats,
        amount_ksats=intent.amount_ksats,
        item_code=(intent.metadata_json or {}).get("item_code", ""),
        item_name=(intent.metadata_json or {}).get("item_name", ""),
        quantity=intent.quantity,
        purchase_reference=intent.purchase_reference,
        expires_at=intent.expires_at,
        invoice_bolt11=inv.invoice_bolt11 if inv else None,
        invoice_expires_at=inv.expires_at if inv else None,
        provider=inv.provider if inv else None,
    )


@router.post("/purchases", response_model=PaymentIntentOut, status_code=201)
async def create_purchase(
    body: PurchaseIn,
    profile: PlayerProfile = Depends(get_current_profile),
    db: AsyncSession = Depends(get_db),
) -> PaymentIntentOut:
    try:
        intent = await shop_service.create_purchase(
            db, profile.id, body.listing_id, body.quantity, body.idempotency_key
        )
    except shop_service.PurchaseError as exc:
        code = str(exc)
        status_map = {
            "listing_not_found": 404,
            "business_closed_power_outage": 409,
            "business_closed_closed": 409,
            "insufficient_stock": 409,
            "invalid_quantity": 422,
        }
        raise error(code, code.replace("_", " "), status_map.get(code, 400))
    inv = (
        await db.execute(
            select(LightningInvoice).where(LightningInvoice.payment_intent_id == intent.id)
        )
    ).scalars().first()
    return _intent_out(intent, inv)


@router.post("/payment-intents/{intent_id}/invoice", response_model=PaymentIntentOut)
async def create_invoice(
    intent_id: str,
    profile: PlayerProfile = Depends(get_current_profile),
    db: AsyncSession = Depends(get_db),
) -> PaymentIntentOut:
    try:
        intent, inv = await invoice_for_intent(db, intent_id)
    except PaymentError:
        raise error("intent_not_found", "Unknown payment intent.", 404)
    if intent.player_id != profile.id:
        raise error("not_your_intent", "This intent belongs to another player.", 403)
    try:
        await create_invoice_for_intent(db, intent)
    except PaymentError as exc:
        code = str(exc).split(":")[0]
        raise error(code, str(exc), 409, retryable="unreachable" in str(exc))
    intent, inv = await invoice_for_intent(db, intent_id)
    return _intent_out(intent, inv)


@router.get("/payment-intents/{intent_id}", response_model=PaymentIntentOut)
async def get_intent(
    intent_id: str,
    profile: PlayerProfile = Depends(get_current_profile),
    db: AsyncSession = Depends(get_db),
) -> PaymentIntentOut:
    intent, inv = await invoice_for_intent(db, intent_id)
    if intent.player_id != profile.id:
        raise error("not_your_intent", "This intent belongs to another player.", 403)
    if intent.status == "awaiting_payment":
        await check_with_node(db, intent, inv)
        intent, inv = await invoice_for_intent(db, intent_id)
    return _intent_out(intent, inv)


@router.post("/payment-intents/{intent_id}/cancel", response_model=PaymentIntentOut)
async def cancel_intent(
    intent_id: str,
    profile: PlayerProfile = Depends(get_current_profile),
    db: AsyncSession = Depends(get_db),
) -> PaymentIntentOut:
    try:
        intent = await mark_intent_cancelled(db, intent_id, profile.id)
    except PaymentError as exc:
        raise error("cancel_error", str(exc), 409)
    intent, inv = await invoice_for_intent(db, intent_id)
    return _intent_out(intent, inv)


@router.get("/lightning/health")
async def lightning_health() -> dict:
    return await get_adapter().get_node_health()


# --------------------------------------------------- real-node webhook (P1-4)
@router.post("/payments/webhook")
async def lightning_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Authenticated Lightning-node settlement webhook.

    Transport authentication (three layers, all required):
      1. Bearer token   - Authorization: Bearer <KK_WEBHOOK_BEARER>
      2. Payload HMAC   - X-KK-Signature = HMAC-SHA256(KK_WEBHOOK_SECRET,
                          "{timestamp}.{raw_body}")
      3. Timestamp win  - X-KK-Timestamp within ±tolerance (anti-replay)

    Application-layer security is unchanged and independent: the event still
    goes through process_settlement, which re-verifies against the adapter and
    enforces exactly-once fulfillment (unique provider_event_id + status
    transition guard). A stolen or replayed webhook can never double-fulfill.
    Disabled (503) until both webhook secrets are configured.
    """
    if not (settings.webhook_bearer_token and settings.webhook_signature_secret):
        raise error("webhook_disabled", "Node webhook is not configured on this server.", 503)

    auth_header = request.headers.get("authorization", "")
    if not hmac.compare_digest(auth_header, f"Bearer {settings.webhook_bearer_token}"):
        raise error("webhook_unauthorized", "Invalid webhook credentials.", 401)

    ts_raw = request.headers.get("x-kk-timestamp", "")
    try:
        ts = int(ts_raw)
    except ValueError:
        raise error("webhook_unauthorized", "Missing or malformed X-KK-Timestamp.", 401)
    if abs(int(time.time()) - ts) > settings.webhook_timestamp_tolerance_seconds:
        raise error("webhook_unauthorized", "Timestamp outside tolerance window.", 401)

    raw = await request.body()
    expected_sig = hmac.new(
        settings.webhook_signature_secret.encode(),
        f"{ts}.".encode() + raw,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(request.headers.get("x-kk-signature", ""), expected_sig):
        raise error("webhook_unauthorized", "Signature verification failed.", 401)

    try:
        data = json.loads(raw)
        settled_at = (
            datetime.fromtimestamp(int(data["settled_at"]), tz=timezone.utc)
            if data.get("settled_at")
            else datetime.now(timezone.utc)
        )
        event = SettlementEvent(
            provider_event_id=f"node-{str(data['provider_event_id'])}"[:128],
            payment_hash=str(data["payment_hash"]),
            bolt11=str(data["bolt11"]) if data.get("bolt11") else None,
            amount_paid_sats=int(data["amount_paid_sats"]),
            settled_at=settled_at,
            raw={"source": "node_webhook", "provider": str(data.get("provider", "unknown"))},
        )
    except (json.JSONDecodeError, KeyError, TypeError, ValueError):
        raise error("webhook_bad_payload", "Could not parse settlement event.", 400)

    outcome = await process_settlement(db, event)

    # Notify the paying player over WS when the event was processed (for
    # rejected_* outcomes the reconciliation worker owns the follow-up).
    if outcome["outcome"] in ("fulfilled", "duplicate"):
        inv = (
            await db.execute(
                select(LightningInvoice).where(LightningInvoice.payment_hash == event.payment_hash)
            )
        ).scalar_one()
        intent = (
            await db.execute(select(PaymentIntent).where(PaymentIntent.id == inv.payment_intent_id))
        ).scalar_one()
        await emit(
            db, "payment.status", intent.id,
            {"intent_id": intent.id, "status": "settled", "outcome": outcome["outcome"],
             "via": "node_webhook"},
            player_id=intent.player_id,
        )
        await db.commit()

    return {"outcome": outcome["outcome"], "provider_event_id": event.provider_event_id}


# ------------------------------------------------------ k-sats deposits
@router.post("/deposits", status_code=201)
async def create_deposit(
    body: DepositIn,
    profile: PlayerProfile = Depends(get_current_profile),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Turn Lightning sats into spendable k-sats (1 sat = 1,000 k-sats).
    Same verified, exactly-once settlement pipeline as purchases: the intent
    is fulfilled by lightning_service.process_settlement."""
    try:
        intent = await create_deposit_intent(db, profile.id, body.sats)
        await create_invoice_for_intent(db, intent)
    except PaymentError as exc:
        code = str(exc).split(":")[0]
        raise error(code, str(exc), 409, retryable="unreachable" in str(exc))
    intent, inv = await invoice_for_intent(db, intent.id)
    return {
        "intent": _intent_out(intent, inv).model_dump(mode="json"),
        "ksats_credits": body.sats * SATS_TO_KSATS,
    }


# ------------------------------------------------------------------ dev-only
@router.post("/dev/lightning/simulate-wallet-payment")
async def dev_simulate_payment(
    body: DevPayIn,
    profile: PlayerProfile = Depends(get_current_profile),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """DEV ONLY (env=local): emulate an external wallet paying an invoice.

    This stands in for a real wallet + node webhook during development and
    demo rehearsal. It emits a server-side SettlementEvent - the client is
    never trusted as proof of payment. Hard-disabled unless settings allow.
    """
    if not settings.dev_sim_allowed:
        raise error("forbidden", "Payment simulation is disabled in this environment.", 403)

    adapter = get_adapter()
    if not isinstance(adapter, MockRegtestAdapter):
        raise error("forbidden", "Simulation requires the mock regtest adapter.", 403)

    # find invoice by exact bolt11 string (the client copies the string)
    inv = (
        await db.execute(
            select(LightningInvoice).where(LightningInvoice.invoice_bolt11 == body.invoice_bolt11)
        )
    ).scalar_one_or_none()
    if not inv:
        raise error("invoice_not_found", "Unknown invoice.", 404)

    intent = (
        await db.execute(select(PaymentIntent).where(PaymentIntent.id == inv.payment_intent_id))
    ).scalar_one()
    if intent.player_id != profile.id:
        raise error("not_your_intent", "This invoice belongs to another player.", 403)

    try:
        event: SettlementEvent = adapter.simulate_external_payment(inv.payment_hash)
    except Exception as exc:  # noqa: BLE001
        raise error("simulation_failed", str(exc), 409)

    outcome = await process_settlement(db, event)
    if outcome["outcome"] == "rejected_unverified_by_node":
        raise error("verification_failed", "Node could not verify settlement.", 409)
    await emit(
        db, "payment.status", intent.id,
        {"intent_id": intent.id, "status": intent.status if outcome["outcome"] == "duplicate" else "settled",
         "simulated": True, "outcome": outcome["outcome"]},
        player_id=intent.player_id,
    )
    await db.commit()
    return {"outcome": outcome["outcome"], "provider_event_id": event.provider_event_id}
