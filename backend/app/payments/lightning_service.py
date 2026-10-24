"""Lightning payment service - orchestrates the 10-step purchase flow.

Critical guarantees implemented here (spec security_rules):
- Settlement is processed idempotently: unique ``provider_event_id`` +
  intent status transition guard ⇒ duplicated events can NEVER deliver
  items twice (acceptance KK-007).
- Fulfillment happens in ONE transaction: mark intent settled → decrement
  listing stock atomically → grant inventory → append ledger reference.
- Invoice association is verified (hash belongs to intent, amount matches).
- A browser message is never proof of settlement (dev simulation endpoint
  emits a server-side SettlementEvent; it does not trust the client).
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.events.outbox_service import emit
from app.models.payments import LightningInvoice, PaymentEvent, PaymentIntent
from app.payments.interfaces import (
    Invoice,
    InvoiceRequest,
    LightningAdapterError,
    SettlementEvent,
)
from app.payments.mock_adapter import get_adapter
from app.services import inventory_service


class PaymentError(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    """SQLite returns naive datetimes; treat them as UTC."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def new_payment_hash() -> str:
    return hashlib.sha256(uuid.uuid4().bytes + uuid.uuid4().hex.encode()).hexdigest()


# In-game money is k-sats. Deposits exchange verified Lightning sats for
# spendable k-sats at a fixed rate: 1 sat = 1,000 k-sats.
SATS_TO_KSATS = 1_000


# ---------------------------------------------------------- k-sats deposits
async def create_deposit_intent(db: AsyncSession, player_id: str, sats: int) -> PaymentIntent:
    """A deposit intent has no listing/item: on verified settlement the ledger is
    credited with sats * SATS_TO_KSATS k-sats, atomically, exactly once."""
    if sats < 1 or sats > 5_000_000:
        raise PaymentError("bad_deposit_amount")
    now = _now()
    intent = PaymentIntent(
        player_id=player_id,
        quantity=1,
        amount_sats=sats,
        amount_ksats=sats * SATS_TO_KSATS,
        currency="sats",
        status="created",
        purchase_reference=f"deposit:{uuid.uuid4().hex[:10]}",
        idempotency_key=f"deposit-{player_id}-{uuid.uuid4().hex[:12]}",
        expires_at=now + timedelta(seconds=settings.invoice_expiry_seconds * 2),
        metadata_json={"kind": "deposit", "item_code": "ksats_deposit", "item_name": "k-sats deposit"},
    )
    db.add(intent)
    await db.flush()
    await db.commit()
    return intent


# ------------------------------------------------------------------ create
async def create_invoice_for_intent(db: AsyncSession, intent: PaymentIntent) -> PaymentIntent:
    """Steps 3-5: create (or return existing) invoice for an authorized intent."""
    if intent.status == "awaiting_payment":
        return intent  # idempotent: never silently replace an invoice
    if intent.status not in ("created", "invoice_pending", "failed"):
        raise PaymentError(f"intent_not_invoiceable_{intent.status}")
    if _aware(intent.expires_at) and _now() > _aware(intent.expires_at):
        intent.status = "expired"
        await db.commit()
        raise PaymentError("intent_expired")

    adapter = get_adapter()
    payment_hash = new_payment_hash()
    item_name = (intent.metadata_json or {}).get("item_name", "Kaduna Kulture purchase")
    memo = f"KadunaKulture: {item_name} x{intent.quantity} ({intent.purchase_reference})"
    try:
        invoice: Invoice = await adapter.create_invoice(
            InvoiceRequest(
                amount_sats=intent.amount_sats,
                memo=memo,
                expiry_seconds=settings.invoice_expiry_seconds,
                payment_hash=payment_hash,
            )
        )
    except LightningAdapterError as exc:
        intent.status = "failed"
        await db.commit()
        raise PaymentError(f"invoice_creation_failed: {exc}") from exc

    li = LightningInvoice(
        payment_intent_id=intent.id,
        provider=invoice.provider,
        provider_invoice_id=invoice.provider_invoice_id,
        payment_hash=invoice.payment_hash,
        invoice_bolt11=invoice.bolt11,
        amount_sats=invoice.amount_sats,
        status="awaiting_payment",
        expires_at=invoice.expires_at,
        memo=memo,
    )
    db.add(li)
    await db.flush()  # li.id exists now: events reference the invoice row
    db.add(
        PaymentEvent(
            provider_event_id=f"inv-created-{invoice.payment_hash[:24]}",
            invoice_id=li.id,
            event_type="invoice.created",
            payload_hash=hashlib.sha256(
                json.dumps({"h": invoice.payment_hash, "a": invoice.amount_sats}).encode()
            ).hexdigest(),
            payload={"payment_hash": invoice.payment_hash, "amount_sats": invoice.amount_sats},
            processed_at=_now(),
        )
    )
    intent.status = "awaiting_payment"
    await db.commit()
    return intent


async def invoice_for_intent(db: AsyncSession, intent_id: str) -> tuple[PaymentIntent, LightningInvoice | None]:
    intent = (
        await db.execute(select(PaymentIntent).where(PaymentIntent.id == intent_id))
    ).scalar_one_or_none()
    if not intent:
        raise PaymentError("intent_not_found")
    inv = (
        await db.execute(
            select(LightningInvoice)
            .where(LightningInvoice.payment_intent_id == intent.id)
            .order_by(LightningInvoice.created_at.desc())
        )
    ).scalars().first()
    return intent, inv


# --------------------------------------------------------------- settlement
async def process_settlement(
    db: AsyncSession, event: SettlementEvent
) -> dict[str, str]:
    """Step 7-8: verify, persist, and fulfill - exactly once.

    Returns an outcome: ``fulfilled`` | ``duplicate`` | ``rejected_<reason>``.
    """
    adapter = get_adapter()

    inv = (
        await db.execute(
            select(LightningInvoice).where(LightningInvoice.payment_hash == event.payment_hash)
        )
    ).scalar_one_or_none()
    if not inv:
        return {"outcome": "rejected_unknown_payment_hash"}

    # Independent verification against the node/adapter - never trust the
    # incoming event alone.
    if not await adapter.validate_settlement_event(event):
        return {"outcome": "rejected_unverified_by_node"}

    intent = (
        await db.execute(select(PaymentIntent).where(PaymentIntent.id == inv.payment_intent_id))
    ).scalar_one()
    intent_id = intent.id  # captured before any rollback can expire the instance
    if event.amount_paid_sats != intent.amount_sats or intent.amount_sats != inv.amount_sats:
        return {"outcome": "rejected_amount_mismatch"}

    # 1) idempotent event record - unique provider_event_id
    payload_hash = hashlib.sha256(
        json.dumps({"h": event.payment_hash, "a": event.amount_paid_sats, "t": int(event.settled_at.timestamp())}, sort_keys=True).encode()
    ).hexdigest()
    existing_event = (
        await db.execute(
            select(PaymentEvent).where(PaymentEvent.provider_event_id == event.provider_event_id)
        )
    ).scalar_one_or_none()
    if existing_event and existing_event.processed_at:
        return {"outcome": "duplicate"}

    # 2) exactly-once fulfillment guard - atomic status transition
    result = await db.execute(
        update(PaymentIntent)
        .where(PaymentIntent.id == intent_id, PaymentIntent.status != "settled")
        .values(
            status="settled",
            fulfilled_at=_now(),
        )
    )
    if result.rowcount == 0:
        # already settled & fulfilled by a competing event
        if existing_event is None:
            db.add(
                PaymentEvent(
                    provider_event_id=event.provider_event_id,
                    invoice_id=inv.id,
                    event_type="invoice.settled",
                    payload_hash=payload_hash,
                    payload={"duplicate": True},
                    processed_at=_now(),
                )
            )
        await db.commit()
        return {"outcome": "duplicate"}

    if existing_event is None:
        db.add(
            PaymentEvent(
                provider_event_id=event.provider_event_id,
                invoice_id=inv.id,
                event_type="invoice.settled",
                payload_hash=payload_hash,
                payload={"payment_hash": event.payment_hash, "amount_paid_sats": event.amount_paid_sats},
                processed_at=_now(),
            )
        )

    # 3) stock decrement with atomic guard (no oversell on the last item)
    if intent.listing_id:
        from app.models.business import ShopListing

        dec = await db.execute(
            update(ShopListing)
            .where(
                ShopListing.id == intent.listing_id,
                ShopListing.quantity_available >= intent.quantity,
            )
            .values(
                quantity_available=ShopListing.quantity_available - intent.quantity,
                version=ShopListing.version + 1,
            )
        )
        if dec.rowcount == 0:
            await db.rollback()
            intent_meta = (
                await db.execute(select(PaymentIntent).where(PaymentIntent.id == intent_id))
            ).scalar_one()
            intent_meta.status = "reconciliation_required"
            await db.commit()
            return {"outcome": "rejected_insufficient_stock_after_payment"}

    # 4) fulfillment, defined by the intent kind - all in this transaction
    if (intent.metadata_json or {}).get("kind") == "deposit":
        # k-sats deposit: the verified sats become spendable game money here
        # (1 sat = SATS_TO_KSATS k-sats), alongside the sats_ref audit entry.
        from app.models.ledger import GameLedgerEntry

        db.add(
            GameLedgerEntry(
                account_reference=f"player:{intent.player_id}",
                asset_type="ksats",
                amount_minor_units=intent.amount_sats * SATS_TO_KSATS,
                transaction_reference=f"deposit:{event.provider_event_id}",
                entry_type="ksats_deposit",
                description=f"Deposited {intent.amount_sats:,} sats -> {intent.amount_sats * SATS_TO_KSATS:,} k-sats",
            )
        )
    elif intent.item_id is not None:
        await inventory_service.grant_items(
            db, intent.player_id, intent.item_id, intent.quantity,
            reference=f"purchase:{intent.purchase_reference}",
        )

    # 5) auditable ledger reference (sats entry references, never spent directly)
    from app.models.ledger import GameLedgerEntry

    db.add(
        GameLedgerEntry(
            account_reference=f"player:{intent.player_id}",
            asset_type="sats_ref",
            amount_minor_units=-intent.amount_sats,
            transaction_reference=f"lightning:{event.provider_event_id}",
            entry_type="payment_settled_ref",
            description=(
                f"Verified Lightning settlement: {intent.quantity}x "
                f"{intent.metadata_json.get('item_name', 'item')} for {intent.amount_sats} sats"
            ),
        )
    )

    inv.status = "settled"
    inv.settled_at = event.settled_at

    # paid billboard advert: put it on air (or into review) in this same
    # transaction, so it happens exactly once with the settlement
    if (intent.metadata_json or {}).get("kind") == "ad":
        from app.services import ads_service

        await ads_service.on_paid(db, intent)

    await emit(
        db, "payment.status", intent.id,
        {
            "intent_id": intent.id,
            "status": "settled",
            "amount_sats": intent.amount_sats,
            "item_code": intent.metadata_json.get("item_code"),
            "item_name": intent.metadata_json.get("item_name"),
            "quantity": intent.quantity,
            "purchase_reference": intent.purchase_reference,
        },
        player_id=intent.player_id,
    )
    await db.commit()
    return {"outcome": "fulfilled", "player_id": intent.player_id, "intent_id": intent.id}


# ------------------------------------------------------------------- misc
async def mark_intent_cancelled(db: AsyncSession, intent_id: str, player_id: str) -> PaymentIntent:
    intent = (
        await db.execute(select(PaymentIntent).where(PaymentIntent.id == intent_id))
    ).scalar_one_or_none()
    if not intent or intent.player_id != player_id:
        raise PaymentError("intent_not_found")
    if intent.status in ("settled",):
        raise PaymentError("cannot_cancel_settled")
    if intent.status in ("created", "awaiting_payment", "invoice_pending"):
        intent.status = "cancelled"
        await db.commit()
    return intent


async def expire_stale_invoices(db: AsyncSession) -> int:
    """Mark awaiting intents expired when their invoice expired (step 10 helper)."""
    invs = (
        await db.execute(
            select(LightningInvoice).where(
                LightningInvoice.status.in_(["created", "awaiting_payment"]),
                LightningInvoice.expires_at.is_not(None),
                LightningInvoice.expires_at < _now(),
            )
        )
    ).scalars().all()
    count = 0
    for inv in invs:
        inv.status = "expired"
        intent = (
            await db.execute(select(PaymentIntent).where(PaymentIntent.id == inv.payment_intent_id))
        ).scalar_one_or_none()
        if intent and intent.status == "awaiting_payment":
            intent.status = "expired"
            await emit(
                db, "payment.status", intent.id,
                {"intent_id": intent.id, "status": "expired"},
                player_id=intent.player_id,
            )
            count += 1
    if count:
        await db.commit()
    return count


async def reconcile_pending(db: AsyncSession) -> int:
    """Step 10: compare unresolved records against authoritative node state."""
    pending = (
        await db.execute(
            select(LightningInvoice).where(
                LightningInvoice.status == "awaiting_payment",
                LightningInvoice.provider == get_adapter().provider,
            )
        )
    ).scalars().all()
    if not pending:
        return 0
    events = await get_adapter().reconcile_pending_invoices([p.payment_hash for p in pending])
    processed = 0
    for ev in events:
        outcome = await process_settlement(db, ev)
        if outcome["outcome"] == "fulfilled":
            processed += 1
    return processed
