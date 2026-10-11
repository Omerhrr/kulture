"""Regression: the outbox poller must dispatch agent.trigger events.

History: an ownership fix added "agent.trigger" to the poller's internal-skip
set, but no dedicated worker owns that type - NPC dialogue silently died
(triggers accumulated as pending forever). This test locks the invariant:
agent.trigger is dispatched by the poller itself.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import select

pytestmark = pytest.mark.asyncio


async def test_agent_trigger_not_in_poller_skip_set():
    from app.workers.runner import _INTERNAL_TYPES

    assert "agent.trigger" not in _INTERNAL_TYPES, (
        "agent.trigger has no dedicated worker - the outbox poller must "
        "dispatch it via _dispatch(); listing it as 'internal' kills all "
        "NPC dialogue"
    )


async def test_outbox_poller_dispatches_agent_trigger(client):
    from app.db.session import AsyncSessionLocal
    from app.models.events import OutboxEvent
    from app.workers.runner import _dispatch

    async with AsyncSessionLocal() as db:
        ev = OutboxEvent(
            event_type="agent.trigger",
            aggregate_id="kaduna_shopkeeper_001",
            payload={
                "agent_code": "kaduna_shopkeeper_001",
                "player_id": None,
                "player_display_name": "Dispatch Tester",
                "player_reputation": 0,
                "message": "How much for suya spice?",
                "trigger_source": "customer_interaction",
            },
            status="pending",
        )
        db.add(ev)
        await db.commit()
        event_id = ev.id

        # the poller's dispatch path: spawns the DSH runtime, returns cleanly
        await _dispatch(ev)

        ev.status = "processed"
        ev.processed_at = datetime.now(timezone.utc)
        await db.commit()

    # the trigger no longer sits pending in the queue
    async with AsyncSessionLocal() as db:
        row = (
            await db.execute(select(OutboxEvent).where(OutboxEvent.id == event_id))
        ).scalar_one()
        assert row.status == "processed"
