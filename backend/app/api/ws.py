"""Game WebSocket — /ws/game?token=<jwt>

Client → server (validated, rate-limited):
  player.move      {position:[x,y,z], facing}   ≤ 20 Hz
  entity.interact  {entity_id, message?}
  world.subscribe  {}
  state.resync     {}

Server → client (authoritative events only):
  player.state, world.event, job.updated, inventory.updated,
  payment.status, npc.dialogue, agent.action, error

Rules enforced here:
- never accept a client message as proof of settlement
- server-side distance validation for interactions (uses last reported move)
- reconnect support: state.resync returns full authoritative snapshot
"""

from __future__ import annotations

import asyncio
import json
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.api.deps import get_current_profile_ws
from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.events.bus import manager
from app.events.outbox_service import emit
from app.models.business import NPCAgent
from app.services import inventory_service, player_service, world_service

router = APIRouter()


class RateLimiter:
    def __init__(self, max_per_second: float) -> None:
        self._interval = 1.0 / max_per_second
        self._last = 0.0
        self._dropped = 0

    def allow(self) -> bool:
        now = time.monotonic()
        if now - self._last >= self._interval:
            self._last = now
            return True
        self._dropped += 1
        return False


@router.websocket("/ws/game")
async def game_socket(ws: WebSocket, token: str = "") -> None:
    await ws.accept()
    async with AsyncSessionLocal() as db:
        profile = await get_current_profile_ws(token, db)
    if profile is None:
        await ws.send_json(
            {"type": "error", "payload": {"code": "unauthorized", "message": "Invalid token"}}
        )
        await ws.close(code=4401)
        return

    player_id = profile.id
    await manager.connect(player_id, ws)
    mover = RateLimiter(settings.movement_rate_limit_hz)
    interactor = RateLimiter(2.0)  # interactions ≤ 2/s
    last_pos: list[float] = [0.0, 0.0, 0.0]
    last_persist = 0.0
    position_dirty = False

    # authoritative snapshot on connect
    async with AsyncSessionLocal() as db:
        out = await player_service.get_player_out(db, player_id)
        await ws.send_json(
            {
                "type": "player.state",
                "payload": {
                    "reason": "connected",
                    "player": out.model_dump() if out else None,
                    "inventory": (await inventory_service.get_inventory_out(db, player_id)).model_dump(),
                },
            }
        )

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
                mtype = msg.get("type")
                payload = msg.get("payload") or {}
            except (json.JSONDecodeError, AttributeError):
                await ws.send_json({"type": "error", "payload": {"code": "bad_json"}})
                continue

            if mtype == "ping":
                await ws.send_json({"type": "pong", "payload": {}})
                continue

            if mtype == "player.move":
                if not mover.allow():
                    continue  # silently drop excess movement messages
                pos = payload.get("position") or [0, 0, 0]
                try:
                    x, y, z = float(pos[0]), float(pos[1]), float(pos[2])
                    facing = float(payload.get("facing", 0.0))
                except (TypeError, ValueError, IndexError):
                    await ws.send_json({"type": "error", "payload": {"code": "bad_move"}})
                    continue
                # world bounds (compact neighborhood): clamp, never trust client
                x = max(-120.0, min(120.0, x))
                z = max(-120.0, min(120.0, z))
                y = max(0.0, min(20.0, y))
                last_pos = [x, y, z]
                position_dirty = True
                now = time.monotonic()
                if now - last_persist > 2.0:  # throttle DB writes
                    async with AsyncSessionLocal() as db:
                        await player_service.apply_movement(db, player_id, x, y, z, facing)
                    last_persist = now
                    position_dirty = False
                continue

            if mtype == "entity.interact":
                if not interactor.allow():
                    await ws.send_json(
                        {"type": "error", "payload": {"code": "rate_limited",
                         "message": "Slow down small."}}
                    )
                    continue
                entity_id = str(payload.get("entity_id", ""))[:64]
                message = str(payload.get("message", ""))[:280]
                async with AsyncSessionLocal() as db:
                    try:
                        result = await world_service.validate_interaction(
                            db, player_id, entity_id, *last_pos
                        )
                    except (LookupError, PermissionError) as exc:
                        await ws.send_json(
                            {"type": "error", "payload": {"code": str(exc) or "interaction_failed"}}
                        )
                        continue
                    await ws.send_json(
                        {"type": "interaction.result", "payload": result.model_dump()}
                    )

                    # customer interaction triggers the DSH shopkeeper (async)
                    npc = (
                        await db.execute(
                            select(NPCAgent).where(NPCAgent.world_entity_id == entity_id)
                        )
                    ).scalar_one_or_none()
                    if npc and npc.status == "active":
                        player_out = await player_service.get_player_out(db, player_id)
                        from app.services.shop_service import get_business_out
                        biz_snapshot = None
                        if npc.business_id:
                            biz = await get_business_out(db, npc.business_id)
                            biz_snapshot = biz.model_dump() if biz else None
                        await emit(
                            db, "agent.trigger", npc.code,
                            {
                                "agent_code": npc.code,
                                "player_id": player_id,
                                "player_display_name": player_out.display_name if player_out else None,
                                "player_reputation": player_out.reputation if player_out else 0,
                                "message": message,
                                "business_snapshot": biz_snapshot,
                                "trigger_source": "customer_interaction",
                            },
                        )
                        await db.commit()
                continue

            if mtype == "world.subscribe":
                await ws.send_json(
                    {"type": "world.subscribed", "payload": {"region": "ali-akilu-road"}}
                )
                continue

            if mtype == "state.resync":
                async with AsyncSessionLocal() as db:
                    out = await player_service.get_player_out(db, player_id)
                    inv = await inventory_service.get_inventory_out(db, player_id)
                await ws.send_json(
                    {
                        "type": "player.state",
                        "payload": {
                            "reason": "resync",
                            "player": out.model_dump() if out else None,
                            "inventory": inv.model_dump(),
                        },
                    }
                )
                continue

            await ws.send_json({"type": "error", "payload": {"code": "unknown_message_type"}})

    except WebSocketDisconnect:
        pass
    except asyncio.CancelledError:
        raise
    finally:
        await manager.disconnect(player_id, ws)
        if position_dirty:
            try:
                async with AsyncSessionLocal() as db:
                    await player_service.apply_movement(
                        db, player_id, *last_pos, facing=0.0
                    )
            except Exception:  # noqa: BLE001
                pass
