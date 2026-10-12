"""Ask Kaduna Kulture - the in-game help assistant (real LLM).

Uses the same OpenAI-compatible client as the NPC agents (KK_LLM_BASE_URL /
KK_LLM_API_KEY / KK_LLM_MODEL - DeepSeek, the local bridge, or any
compatible endpoint). The model gets a compact game guide plus the asking
player's live state, answers in a couple of sentences, and never takes
actions. If no model is reachable it returns answer=null and the client
falls back to its offline FAQ.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.llm_client import llm_client
from app.api.deps import error, get_current_profile
from app.core.config import settings
from app.db.session import get_db
from app.events.presence import presence
from app.models.player import PlayerProfile
from app.services import player_service, shift_service

router = APIRouter(tags=["ask"])

GAME_GUIDE = """You are the friendly in-game guide of Kaduna Kulture, a 3D life simulator of Kaduna, Nigeria, played in the browser.
Answer in 1-3 short sentences, warm and practical, light Nigerian English is welcome ("Sannu", "no wahala"). Never invent features.
Facts:
- Movement: WASD/arrows (Shift to sprint) or tap the ground; on phones a joystick. E (or the action button) talks, boards vehicles, enters homes, uses furniture.
- Dock: Home (walks you home and lets you in), Buy (Musa's shop, pay with Lightning), Map, Phone (apps: Work, Jobs, Bag, Wallet, Maps, Weather, Ask, Me, Settings).
- Needs: hunger, energy, fun, social, hygiene, bladder. Mood comes from them. At home: fridge/gas cooker (hunger), bed (energy, sleeping skips 6 hours), TV (fun), toilet, shower ("baff"). Talking to people raises social.
- Work: Phone > Work. Pick a career (Shop Assistant at Musa's, Fabric Trader at the Textile Market, Park Dispatcher at Kawo Motor Park, Lecturer's Assistant at KASU, Freight Clerk at Rigasa Station). "Go to work" starts an automatic commute by car; "Skip ride" jumps to the destination, "Turn back" returns. Clock in on site and stay the whole shift (a few minutes); tasks add up to +15% pay. Leaving early pays nothing. Pay is simulated naira.
- Delivery jobs: Phone > Jobs. Pick up a package at Musa's Provision Store and deliver it to Hajiya Amina at Stonetech Square.
- Money: naira is game money and is NEVER converted to or from Bitcoin. Lightning payments use real sats (regtest simulator in the demo build): scan the QR with Phoenix, Zeus or BlueWallet; the server verifies settlement with the Lightning node before delivering, exactly once.
- Other players: everyone online appears with an @name tag; the top bar shows how many are online.
- Character: created at first launch (look, 2 traits, a dream, a birth lottery). Phone > Settings can replay the tour or create a new Sim.
If asked something outside the game, answer briefly and steer back to the game. If you don't know, say so."""

_calls: dict[str, deque] = defaultdict(deque)


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=400)
    history: list[dict[str, str]] = Field(default_factory=list, max_length=8)
    # cosmetic client context (needs/mood) - informational only
    context: dict[str, Any] = Field(default_factory=dict)


def _allow(player_id: str) -> bool:
    q = _calls[player_id]
    now = time.monotonic()
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= settings.ask_rate_per_minute:
        return False
    q.append(now)
    return True


@router.post("/ask")
async def ask(body: AskIn, profile: PlayerProfile = Depends(get_current_profile), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    if not _allow(profile.id):
        raise error("rate_limited", "Small small - ask again in a minute.", 429, retryable=True)
    balance = await player_service.ngn_balance_minor(db, profile.id)
    shift = shift_service.shift_out(await shift_service.active_shift(db, profile.id))
    ctx = body.context if isinstance(body.context, dict) else {}
    mood = str(ctx.get("mood", ""))[:24]
    low = ", ".join(str(x)[:12] for x in (ctx.get("low_needs") or [])[:6])
    player_line = (
        f"Player: @{profile.display_name}, balance N{balance // 100:,} (simulated), reputation {profile.reputation}, "
        f"{presence.online_count()} players online"
        + (f", on a shift as {shift['title']} ({int(shift['elapsed_seconds'])}s of {shift['required_seconds']}s)" if shift else ", not working")
        + (f", mood {mood}" if mood else "")
        + (f", low needs: {low}" if low else "")
        + "."
    )
    messages = [{"role": "system", "content": GAME_GUIDE + "\n" + player_line}]
    for m in body.history[-6:]:
        role = m.get("role")
        if role in ("user", "assistant") and isinstance(m.get("content"), str):
            messages.append({"role": role, "content": m["content"][:400]})
    messages.append({"role": "user", "content": body.question})
    res = await llm_client.chat(messages)
    if not res.ok:
        return {"answer": None, "source": "offline", "reason": res.error}
    return {"answer": res.content[:900], "source": "ai"}
