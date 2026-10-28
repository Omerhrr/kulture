"""Careers + workplace shifts.

Rules (server-authoritative, like jobs and payments):
- clock in only while your server-side position is at the workplace
- one active shift per player
- clock out pays only if the shift lasted >= settings.shift_seconds AND you
  are still on site; leaving early ends the shift with no pay
- pay is written to the ledger exactly once (active -> paid transition and
  a unique transaction reference in one commit)
- the task bonus is capped (+15% at 4 tasks) and only moves simulated k-sats
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.events import OutboxEvent
from app.models.ledger import GameLedgerEntry
from app.models.player import PlayerProfile
from app.models.work import WorkShift
from app.models.world import WorldEntity
from app.services import player_service


@dataclass(frozen=True)
class Career:
    id: str
    title: str
    place_code: str
    pay_ksats: int
    reputation: int
    tasks: tuple[str, ...]
    # which town this job is in (None = anywhere: office / remote careers)
    region: str | None = "kaduna"
    needs_any_cert: bool = False


CAREERS: dict[str, Career] = {
    c.id: c
    for c in (
        Career("shop", "Shop Assistant", "musa_shop", 12_000_00, 3,
               ("Stack the shelves", "Serve a customer", "Count the till", "Sweep the shop front")),
        Career("textile", "Fabric Trader", "textile_market", 15_000_00, 4,
               ("Fold the ankara", "Haggle with a buyer", "Measure 6 yards", "Restock the stall")),
        Career("motorpark", "Park Dispatcher", "kawo_motor_park", 14_000_00, 4,
               ("Call the next bus", "Load the boot", "Collect the levy", "Settle a quarrel")),
        Career("campus", "Lecturer's Assistant", "kasu_gate", 18_000_00, 5,
               ("Mark the scripts", "Print the handouts", "Take attendance", "Brief the class")),
        Career("rail", "Freight Clerk", "rigasa_station", 16_000_00, 4,
               ("Check the waybills", "Weigh the cargo", "Radio the driver", "Seal the wagon")),
        # certificate careers (school -> certificate -> career); no fixed site
        Career("developer", "Software Developer", "", 45_000_00, 8,
               ("Fix a bug", "Review a pull request", "Ship a feature", "Stand-up meeting"), None),
        Career("banker", "Bank Officer", "", 40_000_00, 7,
               ("Open an account", "Approve a loan", "Balance the vault", "Advise a customer"), None),
        Career("doctor", "Medical Doctor", "", 60_000_00, 10,
               ("See a patient", "Write a prescription", "Ward round", "Read the lab results"), None),
        Career("manager", "Business Manager", "", 42_000_00, 7,
               ("Plan the week", "Meet a supplier", "Review the books", "Coach the team"), None),
        # ---- the other towns of Kaduna State: work where you live
        Career("abu_lecturer", "ABU Lecturer", "", 38_000_00, 8,
               ("Deliver a lecture", "Supervise a project", "Mark exam scripts", "Office hours"), "zaria", True),
        Career("sabon_gari_trader", "Sabon Gari Trader", "", 16_000_00, 4,
               ("Open the stall", "Bargain with a buyer", "Restock from the depot", "Count the day's takings"), "zaria"),
        Career("ncat_trainee", "NCAT Trainee Pilot", "", 22_000_00, 6,
               ("Pre-flight checks", "Circuit flying", "Radio drills", "Log the flight hours"), "zaria"),
        Career("railway_worker", "Railway Worker", "", 17_000_00, 4,
               ("Check the points", "Couple the wagons", "Grease the axles", "Signal the driver"), "kafanchan"),
        Career("ginger_farmer", "Ginger Farmer", "", 13_000_00, 3,
               ("Weed the ridges", "Harvest the ginger", "Dry it in the sun", "Bag for the market"), "kafanchan"),
        Career("zonkwa_farmer", "Ginger Farmer", "", 13_000_00, 3,
               ("Weed the ridges", "Harvest the ginger", "Dry it in the sun", "Bag for the market"), "zonkwa"),
        Career("timber_worker", "Timber Worker", "", 15_000_00, 4,
               ("Fell a tree", "Saw the planks", "Load the lorry", "Plant seedlings"), "birnin_gwari"),
        Career("kachia_trader", "Market Day Trader", "", 14_000_00, 3,
               ("Set out the yams", "Weigh the grain", "Haggle", "Pack up"), "kachia"),
        Career("truck_loader", "Truck Park Loader", "", 14_000_00, 3,
               ("Load the bags", "Tie the tarp", "Check the manifest", "Wave the trailer off"), "saminaka"),
    )
}
# which certificate each professional career needs
NEEDS_CERT = {"developer": "computer_science", "banker": "banking_finance", "doctor": "medicine", "manager": "business_admin"}
TASK_BONUS_CAP = 4
TASK_BONUS = 0.15
ON_SITE_RADIUS = 30.0
HOME_RADIUS = 120.0


class ShiftError(Exception):
    pass


async def _entity(db: AsyncSession, code: str) -> WorldEntity | None:
    return (await db.execute(select(WorldEntity).where(WorldEntity.code == code))).scalar_one_or_none()


async def _distance_to(db: AsyncSession, player_id: str, code: str) -> float:
    ent = await _entity(db, code)
    if ent is None:
        raise ShiftError("workplace_missing")
    st = await player_service.player_state(db, player_id)
    return math.hypot(st.position_x - ent.position_x, st.position_z - ent.position_z)


async def active_shift(db: AsyncSession, player_id: str) -> WorkShift | None:
    return (
        await db.execute(
            select(WorkShift).where(WorkShift.player_id == player_id, WorkShift.status == "active")
        )
    ).scalar_one_or_none()


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def shift_out(shift: WorkShift | None) -> dict[str, Any] | None:
    if shift is None:
        return None
    c = CAREERS[shift.career]
    elapsed = (datetime.now(timezone.utc) - _aware(shift.started_at)).total_seconds()
    return {
        "id": shift.id,
        "career": shift.career,
        "title": c.title,
        "place_code": c.place_code,
        "status": shift.status,
        "started_at": _aware(shift.started_at).isoformat(),
        "elapsed_seconds": round(elapsed, 1),
        "required_seconds": settings.shift_seconds,
        "tasks_done": shift.tasks_done,
        "tasks": list(c.tasks),
        "pay_ksats": c.pay_ksats,
        "paid_ksats": shift.paid_ksats,
    }


TOWN_NAMES = {"zaria": "Zaria", "kafanchan": "Kafanchan", "zonkwa": "Zonkwa", "birnin_gwari": "Birnin Gwari", "kachia": "Kachia", "saminaka": "Saminaka"}


async def careers_out(db: AsyncSession, region: str = "kaduna") -> list[dict[str, Any]]:
    out = []
    for c in CAREERS.values():
        if c.region is not None and c.region != region:
            continue  # that job is in another town
        if not c.place_code:
            place = f"{TOWN_NAMES.get(c.region or '', 'Kaduna')}" if c.region and c.region != "kaduna" else "Remote / office"
            out.append({"id": c.id, "title": c.title, "place_code": "", "place_name": place, "position": None,
                        "pay_ksats": c.pay_ksats, "reputation": c.reputation, "shift_seconds": settings.shift_seconds,
                        "needs_certificate": NEEDS_CERT.get(c.id) or ("any" if c.needs_any_cert else None)})
            continue
        ent = await _entity(db, c.place_code)
        if ent is None:
            continue
        out.append(
            {
                "id": c.id,
                "title": c.title,
                "place_code": c.place_code,
                "place_name": ent.name,
                "position": [ent.position_x, 0.0, ent.position_z],
                "pay_ksats": c.pay_ksats,
                "reputation": c.reputation,
                "shift_seconds": settings.shift_seconds,
            }
        )
    return out


async def clock_in(db: AsyncSession, player_id: str, career_id: str) -> WorkShift:
    career = CAREERS.get(career_id)
    if career is None:
        raise ShiftError("unknown_career")
    if await active_shift(db, player_id):
        raise ShiftError("shift_already_active")
    from app.services import life_service
    from app.services.travel_service import SLUG_TO_ID, region_of

    if career.region is not None and SLUG_TO_ID.get(await region_of(db, player_id), "kaduna") != career.region:
        raise ShiftError("wrong_town")
    if career_id in NEEDS_CERT:
        if NEEDS_CERT[career_id] not in await life_service.certificates(db, player_id):
            raise ShiftError("certificate_required")
    elif career.needs_any_cert:
        if not await life_service.certificates(db, player_id):
            raise ShiftError("certificate_required")
    elif career.place_code and await _distance_to(db, player_id, career.place_code) > ON_SITE_RADIUS:
        raise ShiftError("not_at_workplace")
    shift = WorkShift(player_id=player_id, career=career_id)
    db.add(shift)
    await db.commit()
    await db.refresh(shift)
    return shift


async def record_task(db: AsyncSession, player_id: str) -> WorkShift:
    shift = await active_shift(db, player_id)
    if shift is None:
        raise ShiftError("no_active_shift")
    # at most one task per (required / 5) seconds, so the bonus takes real time
    elapsed = (datetime.now(timezone.utc) - _aware(shift.started_at)).total_seconds()
    allowed = min(TASK_BONUS_CAP, int(elapsed // max(1, settings.shift_seconds / 5)))
    if shift.tasks_done >= allowed:
        raise ShiftError("task_too_soon")
    shift.tasks_done += 1
    await db.commit()
    return shift


async def clock_out(db: AsyncSession, player_id: str) -> WorkShift:
    shift = await active_shift(db, player_id)
    if shift is None:
        raise ShiftError("no_active_shift")
    career = CAREERS[shift.career]
    now = datetime.now(timezone.utc)
    elapsed = (now - _aware(shift.started_at)).total_seconds()
    on_site = not career.place_code or await _distance_to(db, player_id, career.place_code) <= ON_SITE_RADIUS
    shift.ended_at = now
    if elapsed < settings.shift_seconds or not on_site:
        shift.status = "left_early"
        await db.commit()
        return shift

    bonus = 1 + TASK_BONUS * min(shift.tasks_done, TASK_BONUS_CAP) / TASK_BONUS_CAP
    # experience pays: +10% per career level (Junior .. Oga)
    from app.services import life_service

    lvl, _ = life_service.career_level(await life_service.shifts_worked(db, player_id))
    # working while sick pays half (Phone → Health → hospital)
    st = await life_service.life_state(db, player_id)
    sick = 0.5 if st.sick else 1.0
    pay = int(career.pay_ksats * bonus * (1 + 0.1 * lvl) * sick)
    shift.status = "paid"
    shift.paid_ksats = pay
    db.add(
        GameLedgerEntry(
            account_reference=f"player:{player_id}",
            asset_type="ksats",
            amount_minor_units=pay,
            transaction_reference=f"shift:{shift.id}",
            entry_type="shift_pay",
            description=f"Shift as {career.title}",
        )
    )
    db.add(
        GameLedgerEntry(
            account_reference=f"player:{player_id}",
            asset_type="reputation",
            amount_minor_units=career.reputation,
            transaction_reference=f"shift_rep:{shift.id}",
            entry_type="reputation_gain",
            description=f"Reputation for a shift as {career.title}",
        )
    )
    profile = (await db.execute(select(PlayerProfile).where(PlayerProfile.id == player_id))).scalar_one()
    profile.reputation += career.reputation
    db.add(
        OutboxEvent(
            event_type="player.balance", aggregate_id=shift.id, player_id=player_id,
            payload={"reason": "shift_pay", "amount_ksats": pay},
        )
    )
    await db.commit()
    return shift


async def commute_destination(db: AsyncSession, code: str, home: Any, player_id: str | None = None) -> tuple[float, float] | None:
    """Where a commute skip may land: a known place on the map, or a spot
    near the spawn (your home). Arbitrary coordinates are refused."""
    if code == "home":
        try:
            hx, hz = float(home[0]), float(home[1])
        except (TypeError, ValueError, IndexError):
            return None
        # your own home (the one the game gave you); before characters were
        # kept on the server, homes sat near the spawn
        from app.models.character import Character
        from app.services.character_service import HOME_RADIUS as MY_HOME_RADIUS

        c = await db.get(Character, player_id) if player_id else None
        if c is not None:
            return (hx, hz) if math.hypot(hx - c.home_x, hz - c.home_z) <= MY_HOME_RADIUS else None
        spawn = await _entity(db, "spawn_roadside")
        if spawn is None or math.hypot(hx - spawn.position_x, hz - spawn.position_z) > HOME_RADIUS:
            return None
        return hx, hz
    # any active place on the map (workplaces, shops, landmarks, districts);
    # NPCs are people, not destinations
    ent = await _entity(db, code)
    if ent is None or not ent.is_active or ent.entity_type == "npc":
        return None
    # land on the street side of the entity, not inside it
    return ent.position_x + 4.0, ent.position_z + 4.0
