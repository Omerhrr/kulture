"""Background worker loops.

- outbox poller: dispatches durable domain events (WS fanout + agent triggers)
- invoice expiry checker: expires stale awaiting intents
- reconciliation loop: compares unresolved invoices with node state
- world event scheduler: NEPA Wahala / Market Rush simulated events

All loops are asyncio tasks inside the FastAPI lifespan; they are restart-
safe because every loop is driven by durable DB state (the outbox pattern),
never by in-memory queues that could lose events on crash.
"""

from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from app.agents.orchestrator import orchestrator
from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.events.bus import manager
from app.models.business import Business
from app.models.events import OutboxEvent
from app.payments.lightning_service import expire_stale_invoices, reconcile_pending

log = logging.getLogger("kk.workers")

POLL_INTERVAL = 0.75
_INTERNAL_TYPES = {"agent.trigger", "world.restore_business"}


async def _dispatch(event: OutboxEvent) -> None:
    etype = event.event_type
    payload = event.payload or {}

    if etype == "agent.trigger":
        # Hand off to the DSH runtime in its own task+session.
        asyncio.create_task(_run_agent_safely(dict(payload), event.id))
        return

    if etype in _INTERNAL_TYPES:
        return

    if etype in ("world.event",):
        await manager.broadcast({"type": etype, "payload": payload})
    elif event.player_id:
        await manager.send_to_player(event.player_id, {"type": etype, "payload": payload})
    else:
        # payment/global events without an explicit player go to everyone
        # (e.g. market-wide status) — currently a narrow, safe set:
        if etype in ("npc.dialogue", "agent.action"):
            await manager.broadcast({"type": etype, "payload": payload})
        else:
            await manager.broadcast({"type": etype, "payload": payload})


async def _run_agent_safely(payload: dict, event_id: str) -> None:
    """Runs a DSH agent for a trigger event. Failures are logged, never fatal."""
    try:
        async with AsyncSessionLocal() as db:
            from app.models.business import NPCAgent

            agent = (
                await db.execute(
                    select(NPCAgent).where(NPCAgent.code == payload.get("agent_code"))
                )
            ).scalar_one_or_none()
            if not agent or agent.status != "active":
                return
            context = {
                "player_id": payload.get("player_id"),
                "player_display_name": payload.get("player_display_name"),
                "player_reputation": payload.get("player_reputation"),
                "message": payload.get("message"),
                "business_snapshot": payload.get("business_snapshot"),
                "trigger_source": payload.get("trigger_source") or "customer_interaction",
            }
            await orchestrator.run_for_trigger(
                db, agent, context["trigger_source"], event_id, context
            )
    except Exception as exc:  # noqa: BLE001
        log.warning("agent run failed (event %s): %s", event_id, exc)


async def outbox_worker() -> None:
    while True:
        try:
            async with AsyncSessionLocal() as db:
                rows = (
                    await db.execute(
                        select(OutboxEvent)
                        .where(OutboxEvent.status == "pending")
                        .order_by(OutboxEvent.created_at.asc())
                        .limit(50)
                    )
                ).scalars().all()
                for event in rows:
                    # Internal event types are owned by their dedicated workers
                    # (e.g. business_restore_worker time-gates restores). The
                    # outbox poller must leave them pending — NOT mark processed.
                    if event.event_type in _INTERNAL_TYPES:
                        continue
                    try:
                        await _dispatch(event)
                        event.status = "processed"
                        event.processed_at = datetime.now(timezone.utc)
                    except Exception as exc:  # noqa: BLE001
                        event.attempt_count += 1
                        event.last_error = str(exc)[:250]
                        if event.attempt_count >= 5:
                            event.status = "failed"
                await db.commit()
        except Exception as exc:  # noqa: BLE001
            log.warning("outbox poll error: %s", exc)
        await asyncio.sleep(POLL_INTERVAL)


async def payment_maintenance_worker() -> None:
    while True:
        try:
            async with AsyncSessionLocal() as db:
                await expire_stale_invoices(db)
                await reconcile_pending(db)
        except Exception as exc:  # noqa: BLE001
            log.warning("payment maintenance error: %s", exc)
        await asyncio.sleep(settings.reconciliation_interval_seconds)


# ------------------------------------------------------------ world events
_EVENTS = [
    {
        "id": "power_outage",
        "name": "NEPA Wahala",
        "description": "Power cut! Shops scramble for generators.",
        "effect": "musa_provision_store:closed",
        "duration_s": 100,
    },
    {
        "id": "market_rush",
        "name": "Market Rush",
        "description": "Market rush! Everyone dey buy — vendors happy.",
        "effect": "hype",
        "duration_s": 120,
    },
]


async def world_event_worker() -> None:
    while True:
        await asyncio.sleep(settings.world_event_interval_seconds + random.randint(-40, 40))
        chosen = random.choice(_EVENTS)
        try:
            async with AsyncSessionLocal() as db:
                restore_at = datetime.now(timezone.utc) + timedelta(seconds=chosen["duration_s"])
                if chosen["effect"].startswith("musa_provision_store:closed"):
                    await db.execute(
                        update(Business)
                        .where(Business.code == "musa_provision_store")
                        .values(status="power_outage")
                    )
                    _schedule_restore(db, "musa_provision_store", restore_at)
                await _emit_world_event(
                    db,
                    {
                        "event_id": chosen["id"],
                        "name": chosen["name"],
                        "description": chosen["description"],
                        "restore_at": restore_at.isoformat(),
                    },
                )
                await db.commit()
        except Exception as exc:  # noqa: BLE001
            log.warning("world event error: %s", exc)


def _schedule_restore(db, code: str, restore_at: datetime) -> None:
    from app.models.events import OutboxEvent as OE

    db.add(
        OE(
            event_type="world.restore_business",
            aggregate_id=code,
            payload={"business_code": code, "restore_status": "open", "at": restore_at.isoformat()},
            status="pending",
        )
    )


async def _emit_world_event(db, payload: dict) -> None:
    await _dispatch_now(db, "world.event", payload)


async def _dispatch_now(db, etype: str, payload: dict) -> None:
    from app.events.outbox_service import emit

    await emit(db, etype, payload.get("event_id", "world"), payload)


async def business_restore_worker() -> None:
    """Restores business status when their outage window elapses."""
    while True:
        await asyncio.sleep(10)
        now = datetime.now(timezone.utc)
        try:
            async with AsyncSessionLocal() as db:
                rows = (
                    await db.execute(
                        select(OutboxEvent).where(
                            OutboxEvent.event_type == "world.restore_business",
                            OutboxEvent.status == "pending",
                        )
                    )
                ).scalars().all()
                for row in rows:
                    at = (row.payload or {}).get("at")
                    if not at:
                        row.status = "failed"
                        continue
                    when = datetime.fromisoformat(at)
                    if when <= now:
                        code = row.payload.get("business_code")
                        status = row.payload.get("restore_status", "open")
                        await db.execute(
                            update(Business).where(Business.code == code).values(status=status)
                        )
                        row.status = "processed"
                        row.processed_at = now
                        await _dispatch_now(
                            db,
                            "world.event",
                            {"event_id": f"restore_{code}", "name": "Power Don Come Back",
                             "description": f"{code.replace('_', ' ').title()} don open again!",
                             "restore_at": now.isoformat()},
                        )
                await db.commit()
        except Exception as exc:  # noqa: BLE001
            log.warning("restore worker error: %s", exc)


def start_all() -> list[asyncio.Task]:
    return [
        asyncio.create_task(outbox_worker(), name="kk-outbox"),
        asyncio.create_task(payment_maintenance_worker(), name="kk-payments"),
        asyncio.create_task(world_event_worker(), name="kk-world-events"),
        asyncio.create_task(business_restore_worker(), name="kk-restore"),
    ]
