"""Transactional outbox helpers.

``emit`` appends an OutboxEvent row within the *caller's* session/transaction,
guaranteeing the event is durable exactly when the state change is durable.
The worker runner polls pending events and dispatches them (WS fanout, agent
triggers) with retry accounting.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.events import OutboxEvent


async def emit(
    session: AsyncSession,
    event_type: str,
    aggregate_id: str,
    payload: dict[str, Any],
    player_id: str | None = None,
) -> OutboxEvent:
    event = OutboxEvent(
        event_type=event_type,
        aggregate_id=aggregate_id,
        player_id=player_id,
        payload=payload,
        status="pending",
    )
    session.add(event)
    return event
