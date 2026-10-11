"""P1 hardening: CSRF strategy - the API is bearer-token-only.

Cookies are never used for authentication, so there is no CSRF surface to
defend: no cross-site request can carry a credential the browser attaches
automatically. This test locks that invariant in place.

If cookie sessions ever replace bearer tokens, they MUST ship with:
  - SameSite=Strict (or Lax + strict method checks)
  - a double-submit CSRF token bound to the session
  - Origin/Referer validation on state-changing routes
(see docs/security.md → Authentication).
"""

from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.asyncio


async def test_register_and_login_never_set_cookies(client):
    username = f"nocookie_{uuid.uuid4().hex[:8]}"
    creds = {"username": username, "password": "suyaspice123", "display_name": "No Cookie"}

    r = await client.post("/api/v1/auth/register", json=creds)
    assert r.status_code == 201, r.text
    assert "set-cookie" not in r.headers, "auth must not introduce cookie sessions"

    r2 = await client.post(
        "/api/v1/auth/login", json={"username": username, "password": "suyaspice123"}
    )
    assert r2.status_code == 200, r2.text
    assert "set-cookie" not in r2.headers, "auth must not introduce cookie sessions"


async def test_authenticated_requests_also_set_no_cookies(client, auth_headers):
    r = await client.get("/api/v1/players/me", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert "set-cookie" not in r.headers
