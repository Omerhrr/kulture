"""WebSocket connection manager - fanout of authoritative server events.

Connections are keyed by player id; a player may hold multiple sockets
(multi-tab). The manager never trusts client messages; it only delivers
server-published state.
"""

from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import Any

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, player_id: str, ws: WebSocket) -> None:
        async with self._lock:
            self._connections[player_id].add(ws)

    async def disconnect(self, player_id: str, ws: WebSocket) -> None:
        async with self._lock:
            self._connections[player_id].discard(ws)
            if not self._connections[player_id]:
                self._connections.pop(player_id, None)

    def is_online(self, player_id: str) -> bool:
        return bool(self._connections.get(player_id))

    async def send_to_player(self, player_id: str, message: dict[str, Any]) -> None:
        sockets = list(self._connections.get(player_id, ()))
        if not sockets:
            return
        payload = json.dumps(message, default=str)
        for ws in sockets:
            try:
                await ws.send_text(payload)
            except Exception:
                await self.disconnect(player_id, ws)

    async def broadcast(self, message: dict[str, Any]) -> None:
        payload = json.dumps(message, default=str)
        for player_id in list(self._connections.keys()):
            for ws in list(self._connections.get(player_id, ())):
                try:
                    await ws.send_text(payload)
                except Exception:
                    await self.disconnect(player_id, ws)


manager = ConnectionManager()
