"""Billboard ads: Lightning-paid, moderated, exactly-once activation."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio

AD = {"board_id": "bb-7", "brand": "Mama Put", "headline": "Hot tuwo, cold zobo",
      "subline": "Barnawa, behind the market", "cta": "Order now", "url": "mamaput.ng", "theme": "sun", "days": 2}


async def _pay(client, h, bolt11):
    r = await client.post("/api/v1/dev/lightning/simulate-wallet-payment", json={"invoice_bolt11": bolt11}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


async def test_ad_goes_live_only_after_payment_and_review(client, auth_headers, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "admin_token", "mod-secret")
    r = await client.post("/api/v1/ads", json=AD, headers=auth_headers)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["intent"]["amount_sats"] == settings.ad_price_sats_per_day * 2
    assert body["ad"]["url"] == "https://mamaput.ng"
    assert body["ad"]["status"] == "awaiting_payment"
    boards = (await client.get("/api/v1/ads/boards", headers=auth_headers)).json()["boards"]
    assert "bb-7" not in boards  # unpaid ads never air

    await _pay(client, auth_headers, body["intent"]["invoice_bolt11"])
    mine = (await client.get("/api/v1/ads/mine", headers=auth_headers)).json()
    assert mine[0]["status"] == "pending_review"
    # paying twice (replayed settlement) does not double-activate
    await client.post("/api/v1/dev/lightning/simulate-wallet-payment", json={"invoice_bolt11": body["intent"]["invoice_bolt11"]}, headers=auth_headers)
    assert (await client.get("/api/v1/ads/mine", headers=auth_headers)).json()[0]["status"] == "pending_review"

    # moderation needs the token
    assert (await client.get("/api/v1/admin/ads/pending")).status_code == 403
    pend = (await client.get("/api/v1/admin/ads/pending", headers={"X-Admin-Token": "mod-secret"})).json()
    ad_id = next(a["id"] for a in pend if a["board_id"] == "bb-7")
    ok = await client.post(f"/api/v1/admin/ads/{ad_id}/review", json={"approve": True}, headers={"X-Admin-Token": "mod-secret"})
    assert ok.status_code == 200 and ok.json()["status"] == "live"
    boards = (await client.get("/api/v1/ads/boards", headers=auth_headers)).json()["boards"]
    assert boards["bb-7"][0]["headline"] == "Hot tuwo, cold zobo"
    assert boards["bb-7"][0]["domain"] == "mamaput.ng"


async def test_auto_approve_airs_immediately(client, auth_headers, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "ads_auto_approve", True)
    body = (await client.post("/api/v1/ads", json={**AD, "board_id": "bb-8", "days": 1}, headers=auth_headers)).json()
    await _pay(client, auth_headers, body["intent"]["invoice_bolt11"])
    boards = (await client.get("/api/v1/ads/boards", headers=auth_headers)).json()["boards"]
    assert boards["bb-8"][0]["brand"] == "Mama Put"


@pytest.mark.parametrize(
    "patch,code",
    [
        ({"url": "javascript:alert(1)"}, "bad_url"),
        ({"url": "http://plain.ng"}, "bad_url"),
        ({"url": "https://user@evil.ng"}, "bad_url"),
        ({"board_id": "../etc"}, "bad_board"),
        ({"headline": ""}, "missing_text"),
        ({"days": 99}, "bad_days"),
    ],
)
async def test_bad_ads_rejected(client, auth_headers, patch, code):
    r = await client.post("/api/v1/ads", json={**AD, **patch}, headers=auth_headers)
    assert r.status_code == 422 and r.json()["detail"]["code"] == code


async def test_text_is_sanitised(client, auth_headers):
    r = await client.post("/api/v1/ads", json={**AD, "board_id": "bb-9", "headline": "<b>Big</b> sale\x07"}, headers=auth_headers)
    assert r.json()["ad"]["headline"] == "bBig/b sale"
