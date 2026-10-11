"""P1 hardening: server-authoritative movement reconciliation.

- REST /interactions must use the SERVER-stored position - a POST can no
  longer fabricate proximity to an entity the player never walked to.
- WS player.move is reconciled through a speed envelope: teleport attempts
  are clamped (and reported via player.position_corrected), never trusted.
- The WS session position is seeded from the authoritative server state on
  connect, and persists across reconnects - a fresh session cannot reset the
  server's idea of where the player is.
"""

from __future__ import annotations

import math
import time
import uuid

import pytest
from starlette.testclient import TestClient

# mirrors settings.movement_max_speed_units_per_s (keep in sync)
MAX_SPEED = 14.0


async def test_rest_interaction_cannot_fabricate_proximity(client, auth_headers, world_ctx):
    """Player never moved from spawn; claiming to stand next to Musa fails."""
    musa = world_ctx["entities"]["musa_shop"]
    ex, ey, ez = musa["position"]
    r = await client.post(
        "/api/v1/interactions",
        headers=auth_headers,
        json={"entity_id": musa["id"], "position": [ex + 0.5, 0, ez]},
    )
    assert r.status_code == 422, r.text
    assert r.json()["detail"]["code"] == "too_far"


async def test_rest_interaction_uses_server_position_after_real_movement(
    client, auth_headers, world_ctx
):
    """After a server-side move, interactions work even when the request body
    lies about position - the server uses ITS stored position."""
    from app.db.session import AsyncSessionLocal
    from app.services import player_service

    me = (await client.get("/api/v1/players/me", headers=auth_headers)).json()
    musa = world_ctx["entities"]["musa_shop"]
    spawn = world_ctx["entities"]["spawn_roadside"]
    ex, ey, ez = musa["position"]

    async with AsyncSessionLocal() as db:
        await player_service.apply_movement(db, me["id"], ex + 1.0, 0.0, ez, 0.0)

    # body.position deliberately lies (spawn area) - server position wins
    r = await client.post(
        "/api/v1/interactions",
        headers=auth_headers,
        json={"entity_id": musa["id"], "position": [spawn["position"][0], 0.0, spawn["position"][2]]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["entity_id"] == musa["id"]


# ------------------------------------------------------------------ WS tests
# Sync tests driven through starlette TestClient; DB is only touched via the
# app itself (HTTP/WS) - conftest enables NullPool so portal loops are safe.


def _register(tc: TestClient) -> str:
    username = f"wsauth_{uuid.uuid4().hex[:8]}"
    reg = tc.post(
        "/api/v1/auth/register",
        json={"username": username, "password": "suyaspice123", "display_name": "WS Rider"},
    )
    assert reg.status_code == 201, reg.text
    return reg.json()["access_token"]


def _resync_position(ws) -> list[float]:
    ws.send_json({"type": "state.resync", "payload": {}})
    while True:
        m = ws.receive_json()
        if m["type"] == "player.state" and m["payload"]["reason"] == "resync":
            return m["payload"]["player"]["position"]


def test_ws_teleport_is_clamped_with_correction_event():
    """A single move claiming a ~150-unit jump gets clamped to the speed
    envelope; the authoritative resync shows a position near spawn."""
    from app.main import app

    tc = TestClient(app)
    token = _register(tc)

    with tc.websocket_connect(f"/ws/game?token={token}") as ws:
        hello = ws.receive_json()
        assert hello["type"] == "player.state"
        spawn = hello["payload"]["player"]["position"]

        # teleport attempt - one message, far beyond the envelope
        ws.send_json(
            {"type": "player.move", "payload": {"position": [100.0, 0.0, 100.0], "facing": 0.0}}
        )
        time.sleep(0.2)  # stay under the 20 Hz limiter
        ws.send_json(
            {"type": "player.move", "payload": {"position": [100.0, 0.0, 100.0], "facing": 0.0}}
        )

        # the server must reconcile and report the corrected position
        corrections = []
        for _ in range(3):
            m = ws.receive_json()
            if m["type"] == "player.position_corrected":
                corrections.append(m["payload"]["position"])
                break

        assert corrections, "expected a player.position_corrected event"
        c = corrections[0]
        drift = math.dist((c[0], c[2]), (spawn[0], spawn[2]))
        assert drift <= MAX_SPEED * 1.05, f"clamp failed: {drift} units from spawn"

        pos = _resync_position(ws)
        drift_resync = math.dist((pos[0], pos[2]), (spawn[0], spawn[2]))
        assert drift_resync < 30.0, f"server accepted a teleport: {drift_resync} units"


def test_ws_legitimate_move_within_envelope_is_accepted():
    """A 5-unit move after a 1s pause is well inside the envelope → accepted."""
    from app.main import app

    tc = TestClient(app)
    token = _register(tc)

    with tc.websocket_connect(f"/ws/game?token={token}") as ws:
        hello = ws.receive_json()
        spawn = hello["payload"]["player"]["position"]

        time.sleep(1.05)  # dt cap reached → full speed allowance
        target = [spawn[0] + 5.0, 0.0, spawn[2]]
        ws.send_json({"type": "player.move", "payload": {"position": target, "facing": 0.0}})
        pos = _resync_position(ws)
        assert abs(pos[0] - target[0]) < 0.01, f"legit move not accepted: {pos} vs {target}"


def test_ws_reconnect_seeds_envelope_from_server_state():
    """Position persists across reconnects; a fresh session cannot gain free
    drift because its first move is bounded by the STORED position."""
    from app.main import app

    tc = TestClient(app)
    token = _register(tc)

    with tc.websocket_connect(f"/ws/game?token={token}") as ws:
        hello = ws.receive_json()
        spawn = hello["payload"]["player"]["position"]

        # two legal 12-unit steps east (1.05s apart → full allowance each)
        time.sleep(1.05)
        for step in (12.0, 24.0):
            ws.send_json(
                {
                    "type": "player.move",
                    "payload": {"position": [spawn[0] + step, 0.0, spawn[2]], "facing": 0.0},
                }
            )
            time.sleep(1.05)

    time.sleep(0.5)  # allow the disconnect flush to persist the final position

    with tc.websocket_connect(f"/ws/game?token={token}") as ws2:
        hello2 = ws2.receive_json()
        far = hello2["payload"]["player"]["position"]
        assert far[0] == pytest.approx(spawn[0] + 24.0, abs=0.01), (
            f"disconnect flush failed: {far}"
        )

        # one giant jump back to spawn → clamped to ≤ MAX_SPEED from `far`
        ws2.send_json(
            {"type": "player.move", "payload": {"position": spawn, "facing": 0.0}}
        )
        m = ws2.receive_json()
        assert m["type"] == "player.position_corrected", m
        drift = math.dist(
            (m["payload"]["position"][0], m["payload"]["position"][2]), (far[0], far[2])
        )
        assert drift <= MAX_SPEED * 1.05, f"reconnect envelope failed: {drift}"
