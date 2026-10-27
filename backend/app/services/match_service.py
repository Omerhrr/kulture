"""Phone games lobby: join/create matches, escrow stakes, run bots, settle.

Humans join an open table for the game; if nobody else arrives within
BOT_FILL seconds the table is topped up with bots so nobody waits forever.
Stakes are escrowed on join (charged) and paid to the winner on settle
(the whole pot), or refunded if the table is abandoned."""

from __future__ import annotations

import copy
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.life import GameMatch
from app.services import life_service
from app.services.games_engine import GAMES, GameError, current_seat

BOT_FILL = timedelta(seconds=45)  # long enough for real players to find the table
STAKE_CAP = {"ksats": 500_000, "sats_ref": 1_000}
# never a story or dating-app character's name
BOT_NAMES = ["Sani", "Blessing", "Kabiru", "Hadiza", "Chinedu", "Bilkisu", "Yusuf", "Adaeze", "Garba", "Rabi"]


class MatchError(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def view(m: GameMatch, pid: str) -> dict[str, Any]:
    g = GAMES[m.game]
    out: dict[str, Any] = {
        "id": m.id, "game": m.game, "name": g["name"], "status": m.status, "stake": m.stake, "asset": m.asset,
        "players": m.players, "winner": m.winner, "seq": m.seq, "you": pid,
        "seats": list(g["seats"]),
    }
    if m.state and m.state.get("invite"):
        out["invite"] = m.state["invite"]
    elif m.state:
        out["state"] = g["view"](copy.deepcopy(m.state), pid)
        out["turn"] = current_seat(m.game, m.state) if m.status == "playing" else None
    return out


async def get(db: AsyncSession, match_id: str) -> GameMatch:
    m = await db.get(GameMatch, match_id)
    if not m:
        raise MatchError("no_match")
    return m


async def _start(db: AsyncSession, m: GameMatch) -> None:
    g = GAMES[m.game]
    m.state = g["new"]([p["id"] for p in m.players])
    m.status = "playing"
    m.seq += 1
    _run_bots(m)


def _bots(m: GameMatch) -> set[str]:
    return {p["id"] for p in m.players if p.get("bot")}


def _run_bots(m: GameMatch) -> None:
    """Let bots play until it is a human's turn (or the game ends)."""
    g = GAMES[m.game]
    bots = _bots(m)
    st = copy.deepcopy(m.state)
    for _ in range(400):
        if g["over"](st):
            break
        if g["turn_based"]:
            who = current_seat(m.game, st)
            if who not in bots:
                break
            st = g["move"](st, who, g["bot"](st, who))
        else:
            moved = False
            for b in bots:
                mv = g["bot"](st, b)
                if mv is not None:
                    try:
                        st = g["move"](st, b, mv)
                        moved = True
                    except GameError:
                        pass
            if not moved:
                break
    m.state = st
    flag_modified(m, "state")


async def _settle(db: AsyncSession, m: GameMatch) -> None:
    g = GAMES[m.game]
    if m.status == "done" or not g["over"](m.state):
        return
    m.status = "done"
    m.winner = g["winner"](m.state)
    flag_modified(m, "state")
    pot = m.stake * len([p for p in m.players if not p.get("bot")])
    pot += m.stake * len(_bots(m))  # the house matches bot seats
    if m.stake and m.winner and m.winner not in _bots(m):
        life_service.credit(db, m.winner, pot, "game_win", f"Won {g['name']} pot", m.asset)


INVITE_WAIT = timedelta(minutes=3)


async def join(db: AsyncSession, pid: str, name: str, game: str, stake: int = 0, asset: str = "ksats", vs_bots: bool = False,
               invite: str | None = None, match_id: str | None = None) -> GameMatch:
    """Join a table. `invite` opens a private head-to-head table for one
    friend; `match_id` accepts such an invite (stake comes from the table)."""
    if match_id:
        m = await db.get(GameMatch, match_id)
        invite_for = (m.state or {}).get("invite") if m else None
        # a friend's private invite, or any open public table
        if not m or m.status != "waiting" or (invite_for and invite_for != pid) or any(p["id"] == pid for p in m.players):
            raise MatchError("no_match")
        if not invite_for and len(m.players) >= GAMES[m.game]["seats"][1]:
            raise MatchError("table_full")
        if m.stake:
            try:
                await life_service.charge(db, pid, m.stake, "game_stake", f"{GAMES[m.game]['name']} stake", m.asset)
            except life_service.LifeError:
                raise MatchError("insufficient_funds")
        m.players = [*m.players, {"id": pid, "name": name, "bot": False}]
        flag_modified(m, "players")
        # head-to-head starts as soon as the friend sits; a public table when full
        if invite_for or len(m.players) >= GAMES[m.game]["seats"][1]:
            await _start(db, m)
        await db.commit()
        return m
    if game not in GAMES:
        raise MatchError("unknown_game")
    if asset not in STAKE_CAP or stake < 0 or stake > STAKE_CAP[asset]:
        raise MatchError("bad_stake")
    # already in an unfinished match of this game? return it
    rows = (await db.execute(select(GameMatch).where(GameMatch.game == game, GameMatch.status != "done"))).scalars().all()
    for r in rows:
        if any(p["id"] == pid for p in r.players):
            return r
    if stake:
        try:
            await life_service.charge(db, pid, stake, "game_stake", f"{GAMES[game]['name']} stake", asset)
        except life_service.LifeError:
            raise MatchError("insufficient_funds")
    me = {"id": pid, "name": name, "bot": False}
    lo, hi = GAMES[game]["seats"]
    if invite:
        m = GameMatch(id=str(uuid.uuid4()), game=game, status="waiting", stake=stake, asset=asset, players=[me], state={"invite": invite}, seq=0)
        db.add(m)
        await db.commit()
        return m
    open_ = None if vs_bots else next((r for r in rows if r.status == "waiting" and not (r.state or {}).get("invite") and r.stake == stake and r.asset == asset and len(r.players) < hi), None)
    if open_:
        open_.players = [*open_.players, me]
        flag_modified(open_, "players")
        if len(open_.players) >= hi:
            await _start(db, open_)
        m = open_
    else:
        m = GameMatch(id=str(uuid.uuid4()), game=game, status="waiting", stake=stake, asset=asset, players=[me], state={}, seq=0)
        db.add(m)
        if vs_bots:
            _fill_bots(m)
            await _start(db, m)
    await db.commit()
    return m


async def tables(db: AsyncSession) -> list[dict[str, Any]]:
    """Open public tables waiting for players (newest first)."""
    rows = (await db.execute(select(GameMatch).where(GameMatch.status == "waiting").order_by(GameMatch.created_at.desc()).limit(40))).scalars().all()
    out = []
    for m in rows:
        if (m.state or {}).get("invite"):
            continue
        lo, hi = GAMES[m.game]["seats"]
        left = max(0, int((BOT_FILL - (_now() - _aware(m.created_at))).total_seconds()))
        out.append({"id": m.id, "game": m.game, "name": GAMES[m.game]["name"], "host": m.players[0]["name"] if m.players else "",
                    "players": [p["name"] for p in m.players], "seats": [lo, hi], "stake": m.stake, "asset": m.asset, "bots_in": left})
    return out


async def start_now(db: AsyncSession, pid: str, match_id: str) -> GameMatch:
    """Anyone at a waiting public table can stop waiting: bots fill the rest."""
    m = await get(db, match_id)
    if m.status != "waiting" or (m.state or {}).get("invite") or not any(p["id"] == pid for p in m.players):
        raise MatchError("no_match")
    _fill_bots(m)
    await _start(db, m)
    await db.commit()
    return m


def _fill_bots(m: GameMatch) -> None:
    lo, _hi = GAMES[m.game]["seats"]
    names = random.sample(BOT_NAMES, len(BOT_NAMES))
    players = list(m.players)
    while len(players) < max(lo, 2):
        players.append({"id": f"bot:{uuid.uuid4().hex[:8]}", "name": names.pop(), "bot": True})
    m.players = players
    flag_modified(m, "players")


async def tick(db: AsyncSession, m: GameMatch) -> GameMatch:
    """Advance time-based state: bot fill on waiting tables, trivia rounds."""
    changed = False
    if m.status == "waiting" and (m.state or {}).get("invite"):
        if _now() - _aware(m.created_at) >= INVITE_WAIT:  # friend never came: refund and close
            for p in m.players:
                if m.stake and not p.get("bot"):
                    life_service.credit(db, p["id"], m.stake, "game_refund", "Invite expired - stake returned", m.asset)
            m.status = "done"
            changed = True
    elif m.status == "waiting" and _now() - _aware(m.created_at) >= BOT_FILL:
        _fill_bots(m)
        await _start(db, m)
        changed = True
    elif m.status == "playing":
        before = copy.deepcopy(m.state)
        if not GAMES[m.game]["turn_based"]:
            from app.services.games_engine import _trivia_advance

            st = copy.deepcopy(m.state)
            _trivia_advance(st)
            m.state = st
            _run_bots(m)
        changed = m.state != before
        await _settle(db, m)
        changed = changed or m.status == "done"
    if changed:
        m.seq += 1
        await db.commit()
    return m


async def move(db: AsyncSession, pid: str, match_id: str, mv: Any) -> GameMatch:
    m = await get(db, match_id)
    if m.status != "playing":
        raise MatchError("not_playing")
    if not any(p["id"] == pid for p in m.players):
        raise MatchError("not_in_match")
    g = GAMES[m.game]
    try:
        m.state = g["move"](copy.deepcopy(m.state), pid, mv)
    except GameError as exc:
        raise MatchError(str(exc))
    _run_bots(m)
    await _settle(db, m)
    m.seq += 1
    await db.commit()
    return m


async def leave(db: AsyncSession, pid: str, match_id: str) -> GameMatch:
    """Leaving a waiting table refunds; leaving mid-game forfeits."""
    m = await get(db, match_id)
    if not any(p["id"] == pid for p in m.players):
        raise MatchError("not_in_match")
    if m.status == "waiting":
        m.players = [p for p in m.players if p["id"] != pid]
        life_service.credit(db, pid, m.stake, "game_refund", "Stake refunded", m.asset)
        if not m.players:
            m.status = "done"
    elif m.status == "playing":
        others = [p for p in m.players if p["id"] != pid]
        humans = [p for p in others if not p.get("bot")]
        m.status = "done"
        m.winner = (humans or others)[0]["id"] if others else None
        if m.stake and m.winner and humans:
            life_service.credit(db, m.winner, m.stake * len(m.players), "game_win", "Won by forfeit", m.asset)
    m.seq += 1
    await db.commit()
    return m


async def humans(m: GameMatch) -> list[str]:
    return [p["id"] for p in m.players if not p.get("bot")]
