"""Rules for the phone's multiplayer games, all server-authoritative.

Each game is a pair of pure-ish functions over a JSON state:
    new(players) -> state            players: list of ids (seat order)
    move(state, pid, move) -> state  raises GameError on an illegal move
    bot(state, pid) -> move          a sensible move for a computer seat
    view(state, pid) -> dict         what that player may see
    winner(state) -> id | None, over(state) -> bool

Ayo (oware, abapa rules), Whot (Naija rules), Ludo and Naija trivia.
"""

from __future__ import annotations

import random
import time
from typing import Any


class GameError(Exception):
    pass


# =============================================================== AYO
# pits 0..5 belong to seat 0 (left to right), 6..11 to seat 1; sowing goes
# 0 -> 11 counter-clockwise. Capture 2s and 3s on the opponent's side,
# walking backwards from the last seed. A move that would capture every
# opponent seed captures nothing (grand slam rule).
def ayo_new(players: list[str]) -> dict[str, Any]:
    return {"pits": [4] * 12, "store": [0, 0], "turn": 0, "players": players, "last": None}


def _ayo_side(seat: int) -> range:
    return range(0, 6) if seat == 0 else range(6, 12)


def _ayo_legal(st: dict[str, Any], seat: int) -> list[int]:
    pits = st["pits"]
    opp = 1 - seat
    moves = [p for p in _ayo_side(seat) if pits[p] > 0]
    # must feed an opponent with no seeds if possible
    if sum(pits[p] for p in _ayo_side(opp)) == 0:
        feeding = []
        for p in moves:
            if any(((p + k) % 12) in _ayo_side(opp) for k in range(1, pits[p] + 1)):
                feeding.append(p)
        if feeding:
            return feeding
    return moves


def _ayo_sow(pits: list[int], start: int) -> int:
    seeds = pits[start]
    pits[start] = 0
    i = start
    while seeds:
        i = (i + 1) % 12
        if i == start:
            continue
        pits[i] += 1
        seeds -= 1
    return i


def ayo_move(st: dict[str, Any], pid: str, move: Any) -> dict[str, Any]:
    seat = st["players"].index(pid)
    if seat != st["turn"]:
        raise GameError("not_your_turn")
    pit = int(move)
    if pit not in _ayo_legal(st, seat):
        raise GameError("illegal_move")
    pits = list(st["pits"])
    last = _ayo_sow(pits, pit)
    opp_side = _ayo_side(1 - seat)
    captured = 0
    trial = list(pits)
    i = last
    while i in opp_side and trial[i] in (2, 3):
        captured += trial[i]
        trial[i] = 0
        i -= 1
    if captured and sum(trial[p] for p in opp_side) > 0:
        pits = trial
        st["store"][seat] += captured
    st["pits"] = pits
    st["last"] = {"seat": seat, "pit": pit, "captured": captured}
    st["turn"] = 1 - seat
    # no move for the next player: they collect what's on their side, game ends
    if not _ayo_legal(st, st["turn"]):
        for s in (0, 1):
            st["store"][s] += sum(st["pits"][p] for p in _ayo_side(s))
        st["pits"] = [0] * 12
    return st


def ayo_over(st: dict[str, Any]) -> bool:
    return max(st["store"]) > 24 or sum(st["pits"]) == 0


def ayo_winner(st: dict[str, Any]) -> str | None:
    if not ayo_over(st):
        return None
    a, b = st["store"]
    return st["players"][0] if a > b else st["players"][1] if b > a else None


def ayo_bot(st: dict[str, Any], pid: str) -> Any:
    seat = st["players"].index(pid)
    best, score = None, -1.0
    for p in _ayo_legal(st, seat):
        trial = ayo_move({**st, "pits": list(st["pits"]), "store": list(st["store"])}, pid, p)
        gain = trial["store"][seat] - st["store"][seat] + random.random() * 0.5
        if gain > score:
            best, score = p, gain
    return best


def ayo_view(st: dict[str, Any], pid: str) -> dict[str, Any]:
    seat = st["players"].index(pid) if pid in st["players"] else -1
    return {**st, "you": seat, "legal": _ayo_legal(st, seat) if seat == st["turn"] else []}


# =============================================================== WHOT
SHAPES = {
    "circle": [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14],
    "triangle": [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14],
    "cross": [1, 2, 3, 5, 7, 10, 11, 13, 14],
    "square": [1, 2, 3, 5, 7, 10, 11, 13, 14],
    "star": [1, 2, 3, 4, 5, 7, 8],
}


def _deck() -> list[str]:
    d = [f"{s}:{n}" for s, ns in SHAPES.items() for n in ns] + ["whot:20"] * 5
    random.shuffle(d)
    return d


def _card(c: str) -> tuple[str, int]:
    s, n = c.split(":")
    return s, int(n)


def whot_new(players: list[str]) -> dict[str, Any]:
    deck = _deck()
    hands = {p: [deck.pop() for _ in range(5)] for p in players}
    top = deck.pop()
    while top.startswith("whot"):
        deck.insert(0, top)
        top = deck.pop()
    return {"players": players, "hands": hands, "deck": deck, "pile": [top], "turn": 0, "want": None, "pick": 0, "log": [f"Starting card {top}"], "ended": False}


def _whot_ok(st: dict[str, Any], card: str) -> bool:
    s, n = _card(card)
    ts, tn = _card(st["pile"][-1])
    if st["pick"]:
        return False  # must take the penalty first (no stacking in this house)
    if s == "whot":
        return True
    if st["want"]:
        return s == st["want"]
    return s == ts or n == tn


def _draw(st: dict[str, Any], pid: str, k: int) -> int:
    got = 0
    for _ in range(k):
        if not st["deck"]:
            # reshuffle the pile under the top card
            top = st["pile"].pop()
            st["deck"] = st["pile"]
            random.shuffle(st["deck"])
            st["pile"] = [top]
        if not st["deck"]:
            break
        st["hands"][pid].append(st["deck"].pop())
        got += 1
    return got


def _next(st: dict[str, Any], skip: int = 1) -> None:
    st["turn"] = (st["turn"] + skip) % len(st["players"])


def whot_move(st: dict[str, Any], pid: str, move: Any) -> dict[str, Any]:
    """move: {"play": card, "shape"?: requested shape} | {"draw": true}"""
    if st["players"][st["turn"]] != pid:
        raise GameError("not_your_turn")
    hand = st["hands"][pid]
    name = pid
    if isinstance(move, dict) and move.get("draw"):
        n = max(1, st["pick"])
        _draw(st, pid, n)
        st["log"].append(f"{name} picked {n}")
        st["pick"] = 0
        _next(st)
        return st
    card = move.get("play") if isinstance(move, dict) else None
    if card not in hand or not _whot_ok(st, card):
        raise GameError("illegal_move")
    hand.remove(card)
    st["pile"].append(card)
    st["want"] = None
    s, n = _card(card)
    st["log"].append(f"{name} played {card}")
    if not hand:
        st["ended"] = True
        return st
    others = [p for p in st["players"] if p != pid]
    if n == 20:
        want = move.get("shape") if move.get("shape") in SHAPES else "circle"
        st["want"] = want
        st["log"].append(f"I need {want}")
        _next(st)
    elif n == 1:  # hold on: play again
        pass
    elif n == 2:
        st["pick"] = 2
        _next(st)
    elif n == 5:
        st["pick"] = 3
        _next(st)
    elif n == 8:  # suspension
        _next(st, 2)
    elif n == 14:  # general market: everybody else picks one
        for o in others:
            _draw(st, o, 1)
        st["log"].append("General market!")
    else:
        _next(st)
    return st


def whot_over(st: dict[str, Any]) -> bool:
    return st["ended"] or (not st["deck"] and len(st["pile"]) <= 1)


def whot_winner(st: dict[str, Any]) -> str | None:
    for p in st["players"]:
        if not st["hands"][p]:
            return p
    if whot_over(st):
        return min(st["players"], key=lambda p: sum(_card(c)[1] for c in st["hands"][p]))
    return None


def whot_bot(st: dict[str, Any], pid: str) -> Any:
    hand = st["hands"][pid]
    ok = [c for c in hand if _whot_ok(st, c)]
    if not ok:
        return {"draw": True}
    # prefer attacks, keep whot for last
    ok.sort(key=lambda c: (c.startswith("whot"), -(_card(c)[1] in (2, 5, 8, 14, 1))))
    card = ok[0]
    shapes = [_card(c)[0] for c in hand if not c.startswith("whot") and c != card]
    want = max(set(shapes), key=shapes.count) if shapes else "circle"
    return {"play": card, "shape": want}


def whot_view(st: dict[str, Any], pid: str) -> dict[str, Any]:
    return {
        "players": st["players"],
        "you": st["players"].index(pid) if pid in st["players"] else -1,
        "hand": st["hands"].get(pid, []),
        "counts": {p: len(h) for p, h in st["hands"].items()},
        "top": st["pile"][-1],
        "turn": st["turn"],
        "want": st["want"],
        "pick": st["pick"],
        "deck": len(st["deck"]),
        "log": st["log"][-6:],
        "playable": [c for c in st["hands"].get(pid, []) if _whot_ok(st, c)] if st["players"][st["turn"]] == pid else [],
    }


# =============================================================== LUDO
# 52-square loop; seat s starts at 13*s. A token's progress: -1 in base,
# 0..50 on the loop (relative to its start), 51..56 in the home column,
# 57 = home. Safe squares: every start and the star 8 squares after it.
SAFE = {0, 8, 13, 21, 26, 34, 39, 47}


def ludo_new(players: list[str]) -> dict[str, Any]:
    return {"players": players, "tokens": {p: [-1, -1, -1, -1] for p in players}, "turn": 0, "die": None, "rolled": False, "log": [], "sixes": 0}


def _abs(seat: int, prog: int) -> int:
    return (13 * seat + prog) % 52


def _ludo_moves(st: dict[str, Any], pid: str) -> list[int]:
    d = st["die"]
    out = []
    for i, p in enumerate(st["tokens"][pid]):
        if p == -1 and d == 6:
            out.append(i)
        elif 0 <= p and p + d <= 57:
            out.append(i)
    return out


def ludo_move(st: dict[str, Any], pid: str, move: Any) -> dict[str, Any]:
    """move: {"roll": true} then {"token": i}."""
    seat = st["players"].index(pid)
    if seat != st["turn"]:
        raise GameError("not_your_turn")
    if isinstance(move, dict) and move.get("roll"):
        if st["rolled"]:
            raise GameError("already_rolled")
        st["die"] = random.randint(1, 6)
        st["rolled"] = True
        st["log"].append(f"{pid} rolled {st['die']}")
        if not _ludo_moves(st, pid):
            st["rolled"] = False
            st["sixes"] = 0
            _next(st)
        return st
    if not st["rolled"]:
        raise GameError("roll_first")
    i = int(move.get("token", -1)) if isinstance(move, dict) else -1
    if i not in _ludo_moves(st, pid):
        raise GameError("illegal_move")
    toks = st["tokens"][pid]
    d = st["die"]
    toks[i] = 0 if toks[i] == -1 else toks[i] + d
    captured = False
    if toks[i] <= 50:
        sq = _abs(seat, toks[i])
        if sq not in SAFE:
            for o in st["players"]:
                if o == pid:
                    continue
                os_ = st["players"].index(o)
                for j, q in enumerate(st["tokens"][o]):
                    if 0 <= q <= 50 and _abs(os_, q) == sq:
                        st["tokens"][o][j] = -1
                        captured = True
                        st["log"].append(f"{pid} sent {o} home!")
    st["rolled"] = False
    # a six, a capture or reaching home earns another roll (max three sixes)
    if (d == 6 and st["sixes"] < 2) or captured or toks[i] == 57:
        st["sixes"] = st["sixes"] + 1 if d == 6 else 0
    else:
        st["sixes"] = 0
        _next(st)
    return st


def ludo_over(st: dict[str, Any]) -> bool:
    return any(all(t == 57 for t in ts) for ts in st["tokens"].values())


def ludo_winner(st: dict[str, Any]) -> str | None:
    for p, ts in st["tokens"].items():
        if all(t == 57 for t in ts):
            return p
    return None


def ludo_bot(st: dict[str, Any], pid: str) -> Any:
    if not st["rolled"]:
        return {"roll": True}
    seat = st["players"].index(pid)
    moves = _ludo_moves(st, pid)
    toks = st["tokens"][pid]

    def value(i: int) -> float:
        p = toks[i]
        np_ = 0 if p == -1 else p + st["die"]
        v = np_ / 10 + random.random() * 0.2
        if p == -1:
            v += 3
        if np_ == 57:
            v += 5
        if np_ <= 50:
            sq = _abs(seat, np_)
            for o in st["players"]:
                if o != pid and sq not in SAFE and any(0 <= q <= 50 and _abs(st["players"].index(o), q) == sq for q in st["tokens"][o]):
                    v += 8
        return v

    return {"token": max(moves, key=value)}


def ludo_view(st: dict[str, Any], pid: str) -> dict[str, Any]:
    seat = st["players"].index(pid) if pid in st["players"] else -1
    return {**st, "you": seat, "movable": _ludo_moves(st, pid) if seat == st["turn"] and st["rolled"] else []}


# =============================================================== TRIVIA
TRIVIA = [
    ("What is the capital of Kaduna State?", ["Zaria", "Kaduna", "Kafanchan", "Kano"], 1),
    ("Which river gives Kaduna its name?", ["River Niger", "River Benue", "River Kaduna", "River Gongola"], 2),
    ("'Kaduna' comes from the Hausa word for…", ["Lions", "Crocodiles", "Rivers", "Horses"], 1),
    ("Nigeria became independent in…", ["1957", "1960", "1963", "1970"], 1),
    ("Which is the largest market for textiles in Kaduna?", ["Kantin Kwari", "Kasuwan Barchi", "Kawo Market", "Sheikh Gumi Market"], 1),
    ("Lugard Hall in Kaduna was built as…", ["A mosque", "The Northern House of Assembly", "A railway station", "A cinema"], 1),
    ("Ahmadu Bello was the first Premier of…", ["Lagos State", "Northern Region", "Western Region", "Kaduna State"], 1),
    ("Jollof rice is a dish from…", ["West Africa", "East Asia", "South America", "Europe"], 0),
    ("Which of these is a Hausa greeting?", ["Bawo ni", "Kedu", "Sannu", "Ndewo"], 2),
    ("Super Eagles is the nickname of Nigeria's…", ["Basketball team", "Football team", "Air force", "Band"], 1),
    ("Suya is mostly made from…", ["Fish", "Spiced grilled meat", "Rice", "Beans"], 1),
    ("Kajuru Castle is in which state?", ["Plateau", "Kaduna", "Niger", "Bauchi"], 1),
    ("Nigeria's currency is the…", ["Cedi", "Rand", "Naira", "Shilling"], 2),
    ("What does NEPA in Nigerian slang refer to?", ["Police", "Electricity supply", "Water board", "Taxi"], 1),
    ("Harmattan is a…", ["Festival", "Dry dusty wind season", "Hausa dance", "Kind of bread"], 1),
    ("Which city hosts the Nigerian Defence Academy?", ["Kaduna", "Abuja", "Jos", "Ibadan"], 0),
    ("Which planet is closest to the sun?", ["Venus", "Mercury", "Mars", "Earth"], 1),
    ("How many states does Nigeria have?", ["30", "36", "37", "40"], 1),
    ("Masa (waina) is made from…", ["Rice or millet", "Yam", "Cassava leaves", "Plantain"], 0),
    ("Sallah celebrations follow which month of fasting?", ["Ramadan", "Lent", "Advent", "Muharram"], 0),
    ("The Kaduna–Abuja train is run by…", ["NRC", "NNPC", "NIPOST", "NAFDAC"], 0),
    ("1 bitcoin is divided into 100 million…", ["Bits", "Satoshis", "Kobo", "Coins"], 1),
]
TRIVIA_ROUNDS = 7
TRIVIA_SECONDS = 15


def trivia_new(players: list[str]) -> dict[str, Any]:
    qs = random.sample(range(len(TRIVIA)), TRIVIA_ROUNDS)
    return {"players": players, "qs": qs, "round": 0, "answers": {}, "scores": {p: 0 for p in players}, "deadline": time.time() + TRIVIA_SECONDS, "opened": time.time(), "reveal": None}


def _trivia_advance(st: dict[str, Any]) -> None:
    """Close the round if everyone answered or time is up."""
    if st["round"] >= TRIVIA_ROUNDS:
        return
    if len(st["answers"]) < len(st["players"]) and time.time() < st["deadline"]:
        return
    q = TRIVIA[st["qs"][st["round"]]]
    for p, (ans, at) in st["answers"].items():
        if ans == q[2]:
            speed = 0.45 if p.startswith("bot:") else max(0.0, 1 - (at - st["opened"]) / TRIVIA_SECONDS)
            st["scores"][p] += 100 + int(100 * speed)
    st["reveal"] = {"round": st["round"], "answer": q[2], "answers": {p: a for p, (a, _) in st["answers"].items()}}
    st["round"] += 1
    st["answers"] = {}
    st["opened"] = time.time()
    st["deadline"] = time.time() + TRIVIA_SECONDS


def trivia_move(st: dict[str, Any], pid: str, move: Any) -> dict[str, Any]:
    _trivia_advance(st)
    if st["round"] >= TRIVIA_ROUNDS:
        raise GameError("game_over")
    if pid in st["answers"]:
        raise GameError("already_answered")
    st["answers"][pid] = (int(move.get("answer", -1)) if isinstance(move, dict) else -1, time.time())
    _trivia_advance(st)
    return st


def trivia_over(st: dict[str, Any]) -> bool:
    _trivia_advance(st)
    return st["round"] >= TRIVIA_ROUNDS


def trivia_winner(st: dict[str, Any]) -> str | None:
    if not trivia_over(st):
        return None
    best = max(st["scores"].values())
    tops = [p for p, s in st["scores"].items() if s == best]
    return tops[0] if len(tops) == 1 else None


def trivia_bot(st: dict[str, Any], pid: str) -> Any:
    q = TRIVIA[st["qs"][min(st["round"], TRIVIA_ROUNDS - 1)]]
    right = random.random() < 0.65
    return {"answer": q[2] if right else random.choice([i for i in range(4) if i != q[2]])}


def trivia_view(st: dict[str, Any], pid: str) -> dict[str, Any]:
    _trivia_advance(st)
    r = st["round"]
    cur = None
    if r < TRIVIA_ROUNDS:
        q = TRIVIA[st["qs"][r]]
        cur = {"q": q[0], "options": q[1], "seconds_left": max(0, round(st["deadline"] - time.time(), 1))}
    return {"players": st["players"], "round": r, "rounds": TRIVIA_ROUNDS, "question": cur, "answered": pid in st["answers"], "scores": st["scores"], "reveal": st["reveal"]}


# =============================================================== registry
GAMES: dict[str, dict[str, Any]] = {
    "ayo": {"name": "Ayo", "seats": (2, 2), "new": ayo_new, "move": ayo_move, "bot": ayo_bot, "view": ayo_view, "over": ayo_over, "winner": ayo_winner, "turn_based": True},
    "whot": {"name": "Whot", "seats": (2, 4), "new": whot_new, "move": whot_move, "bot": whot_bot, "view": whot_view, "over": whot_over, "winner": whot_winner, "turn_based": True},
    "ludo": {"name": "Ludo", "seats": (2, 4), "new": ludo_new, "move": ludo_move, "bot": ludo_bot, "view": ludo_view, "over": ludo_over, "winner": ludo_winner, "turn_based": True},
    "trivia": {"name": "Naija Trivia", "seats": (2, 4), "new": trivia_new, "move": trivia_move, "bot": trivia_bot, "view": trivia_view, "over": trivia_over, "winner": trivia_winner, "turn_based": False},
}


def current_seat(game: str, st: dict[str, Any]) -> str | None:
    if game == "trivia":
        return None
    return st["players"][st["turn"]]
