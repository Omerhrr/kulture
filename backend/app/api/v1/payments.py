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

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import error, get_current_profile
from app.core.config import settings
from app.db.session import get_db
from app.events.outbox_service import emit
from app.models.business import Business
from app.models.payments import LightningInvoice, PaymentIntent
from app.models.player import PlayerProfile
from app.payments.interfaces import SettlementEvent
from app.payments.lightning_service import (
    PaymentError,
    create_invoice_for_intent,
    invoice_for_intent,
    mark_intent_cancelled,
    process_settlement,
)
from app.payments.mock_adapter import MockRegtestAdapter, get_adapter
from app.schemas.game import DevPayIn, PaymentIntentOut, PurchaseIn
from app.services import shop_service

router = APIRouter(tags=["payments"])


def _intent_out(intent: PaymentIntent, inv) -> PaymentIntentOut:
    return PaymentIntentOut(
        id=intent.id,
        status=intent.status,
        amount_sats=intent.amount_sats,
        amount_ngn_minor=intent.amount_ngn_minor,
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


# ------------------------------------------------------------------ dev-only
@router.post("/dev/lightning/simulate-wallet-payment")
async def dev_simulate_payment(
    body: DevPayIn,
    profile: PlayerProfile = Depends(get_current_profile),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """DEV ONLY (env=local): emulate an external wallet paying an invoice.

    This stands in for a real wallet + node webhook during development and
    demo rehearsal. It emits a server-side SettlementEvent — the client is
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
