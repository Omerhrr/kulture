"""Live street-race lobbies (in memory). Players on the same route share one
start time and see each other's checkpoint progress in real time. Times
that count for prizes still go through POST /races/time (validated)."""

from __future__ import annotations

import time
from typing import Any

from app.events.bus import manager

GRACE_S = 8.0  # after the first racer is ready, others have this long to join
STALE_S = 240.0


class RaceHub:
    def __init__(self) -> None:
        self.lobbies: dict[str, dict[str, Any]] = {}

    def _lobby(self, route: str) -> dict[str, Any]:
        lb = self.lobbies.get(route)
        now = time.time()
        if lb and (lb["start_at"] and now - lb["start_at"] > STALE_S or not lb["players"]):
            lb = None
        if lb and lb["start_at"] and now > lb["start_at"] + 2:
            # already racing: late joiners wait for the next heat
            lb = None if all(p["finished"] or p["left"] for p in lb["players"].values()) else lb
        if lb is None:
            lb = {"route": route, "start_at": 0.0, "players": {}}
            self.lobbies[route] = lb
        return lb

    def view(self, lb: dict[str, Any]) -> dict[str, Any]:
        return {"route": lb["route"], "start_at": lb["start_at"], "server_now": time.time(),
                "players": [{"id": k, **v} for k, v in lb["players"].items() if not v["left"]]}

    async def _push(self, lb: dict[str, Any]) -> None:
        msg = {"type": "race.lobby", "payload": self.view(lb)}
        for pid, p in lb["players"].items():
            if not p["left"]:
                await manager.send_to_player(pid, msg)

    def _find(self, pid: str) -> dict[str, Any] | None:
        for lb in self.lobbies.values():
            if pid in lb["players"] and not lb["players"][pid]["left"]:
                return lb
        return None

    async def handle(self, pid: str, name: str, mtype: str, payload: dict[str, Any]) -> None:
        if mtype == "race.join":
            route = str(payload.get("route", ""))[:32]
            old = self._find(pid)
            if old and old["route"] != route:
                old["players"][pid]["left"] = True
                await self._push(old)
            lb = self._lobby(route)
            if lb["start_at"] and time.time() > lb["start_at"]:
                return
            lb["players"].setdefault(pid, {"name": name, "cp": 0, "ms": 0, "ready": False, "finished": False, "left": False})
            lb["players"][pid]["left"] = False
            await self._push(lb)
            return
        lb = self._find(pid)
        if not lb:
            return
        me = lb["players"][pid]
        if mtype == "race.ready":
            me["ready"] = True
            if not lb["start_at"]:
                lb["start_at"] = time.time() + GRACE_S
        elif mtype == "race.progress":
            me["cp"] = max(me["cp"], int(payload.get("cp", 0)))
            me["ms"] = int(payload.get("ms", 0))
        elif mtype == "race.finish":
            me["finished"] = True
            me["ms"] = int(payload.get("ms", 0))
        elif mtype == "race.leave":
            me["left"] = True
        else:
            return
        await self._push(lb)


race_hub = RaceHub()
