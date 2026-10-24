"""Family, business management, health, politics, town activities, crews,
gifting (see services/society_service.py)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import error, get_current_profile
from app.db.session import get_db
from app.events.bus import manager
from app.models.player import PlayerProfile
from app.services import society_service as ss
from app.services.society_service import SocietyError

router = APIRouter(tags=["society"])

MSG = {
    "insufficient_funds": "Not enough k-sats for that.",
    "not_married": "You need to be married first (Phone → Connect).",
    "family_full": "Your house is full - four children is plenty!",
    "needs_name": "Give the baby a name.",
    "no_such_child": "Child not found.",
    "already_in_school": "Already in school.",
    "no_business": "You don't run a business yet (Phone → Life).",
    "stock_full": "The store room is full.",
    "staff_full": "No room for more staff at this size - upgrade first.",
    "max_level": "Already the biggest it can be.",
    "nothing_to_collect": "No takings yet - come back later.",
    "already_in_office": "You're already the councillor.",
    "already_campaigning": "Your campaign is already running.",
    "not_enough_reputation": "People don't know you well enough yet - build your reputation first.",
    "not_campaigning": "Declare your candidacy first.",
    "too_soon": "Give it a little time before doing that again.",
    "not_in_office": "Only the ward councillor can do that.",
    "wrong_town": "That's in another town - travel there first.",
    "already_in_crew": "You're already in a crew.",
    "bad_name": "Pick a name (3+ letters) and a tag (2-5 letters).",
    "name_taken": "That crew name is taken.",
    "no_such_crew": "Crew not found.",
    "crew_full": "That crew is full.",
    "not_in_crew": "You're not in a crew.",
    "no_such_person": "Couldn't find that person.",
    "bad_amount": "Gifts are up to 5M k-sats.",
    "no_such_item": "You don't have that item.",
    "empty": "Nothing to send.",
    "bad_action": "That isn't possible.",
}


def _err(e: SocietyError):
    c = str(e)
    return error(c, MSG.get(c, c), 404 if c.startswith("no_such") else 409)


async def _run(coro):
    try:
        return await coro
    except SocietyError as e:
        raise _err(e)


Me = Depends(get_current_profile)
Db = Depends(get_db)


# ---- family
class BabyIn(BaseModel):
    name: str = Field(max_length=48)
    gender: str = "boy"


class CareIn(BaseModel):
    child_id: str
    action: str


@router.get("/family")
async def family(profile: PlayerProfile = Me, db: AsyncSession = Db) -> dict[str, Any]:
    return await ss.family(db, profile.id)


@router.post("/family/baby")
async def baby(body: BabyIn, profile: PlayerProfile = Me, db: AsyncSession = Db) -> dict[str, Any]:
    return {"child": await _run(ss.have_baby(db, profile.id, body.name, body.gender))}


@router.post("/family/care")
async def care(body: CareIn, profile: PlayerProfile = Me, db: AsyncSession = Db) -> dict[str, Any]:
    return {"child": await _run(ss.care(db, profile.id, body.child_id, body.action))}


# ---- business
class BizIn(BaseModel):
    action: str
    value: int = 0


@router.get("/business")
async def biz(profile: PlayerProfile = Me, db: AsyncSession = Db) -> dict[str, Any]:
    try:
        return await ss.business_status(db, profile.id)
    except SocietyError as e:
        if str(e) == "no_business":
            return {"none": True}  # a normal state, not an error
        raise _err(e) from None


@router.post("/business/action")
async def biz_action(body: BizIn, profile: PlayerProfile = Me, db: AsyncSession = Db) -> dict[str, Any]:
    return await _run(ss.business_action(db, profile.id, body.action, body.value))


@router.post("/business/collect")
async def biz_collect(profile: PlayerProfile = Me, db: AsyncSession = Db) -> dict[str, Any]:
    return await _run(ss.collect(db, profile.id))


# ---- health
@router.get("/health/me")
async def health(profile: PlayerProfile = Me, db: AsyncSession = Db) -> dict[str, Any]:
    return await ss.health(db, profile.id)


@router.post("/health/hospital")
async def hospital(profile: PlayerProfile = Me, db: AsyncSession = Db) -> dict[str, Any]:
    return await _run(ss.hospital(db, profile.id))


# ---- politics
class ActIn(BaseModel):
    action: str


@router.get("/politics")
async def politics(profile: PlayerProfile = Me, db: AsyncSession = Db) -> dict[str, Any]:
    return await ss.politics(db, profile.id)


@router.post("/politics/declare")
async def declare(profile: PlayerProfile = Me, db: AsyncSession = Db) -> dict[str, Any]:
    return await _run(ss.declare(db, profile.id))


@router.post("/politics/campaign")
async def campaign(body: ActIn, profile: PlayerProfile = Me, db: AsyncSession = Db) -> dict[str, Any]:
    return await _run(ss.campaign(db, profile.id, body.action))


@router.post("/politics/project")
async def project(body: ActIn, profile: PlayerProfile = Me, db: AsyncSession = Db) -> dict[str, Any]:
    return await _run(ss.project(db, profile.id, body.action))


@router.post("/politics/allowance")
async def allowance(profile: PlayerProfile = Me, db: AsyncSession = Db) -> dict[str, Any]:
    return await _run(ss.allowance(db, profile.id))


# ---- town activities
class ActivityIn(BaseModel):
    id: str
    result: dict[str, Any] | None = None


@router.get("/activities")
async def activities() -> dict[str, Any]:
    return {"activities": ss.ACTIVITIES}


@router.post("/activities/do")
async def do_activity(body: ActivityIn, profile: PlayerProfile = Me, db: AsyncSession = Db) -> dict[str, Any]:
    return await _run(ss.activity(db, profile.id, body.id, body.result))


# ---- crews
class CrewIn(BaseModel):
    name: str = Field(max_length=40)
    tag: str = Field(max_length=8)
    color: str = Field(default="#e0a020", max_length=9)


class SayIn(BaseModel):
    text: str = Field(max_length=400)


@router.get("/crews")
async def crews(profile: PlayerProfile = Me, db: AsyncSession = Db) -> dict[str, Any]:
    return await ss.crews(db, profile.id)


@router.post("/crews")
async def create_crew(body: CrewIn, profile: PlayerProfile = Me, db: AsyncSession = Db) -> dict[str, Any]:
    return {"crew": await _run(ss.create_crew(db, profile.id, body.name, body.tag, body.color))}


@router.post("/crews/{crew_id}/join")
async def join_crew(crew_id: str, profile: PlayerProfile = Me, db: AsyncSession = Db) -> dict[str, Any]:
    return {"crew": await _run(ss.join_crew(db, profile.id, crew_id))}


@router.post("/crews/leave")
async def leave_crew(profile: PlayerProfile = Me, db: AsyncSession = Db) -> dict[str, Any]:
    await _run(ss.leave_crew(db, profile.id))
    return {"ok": True}


@router.post("/crews/say")
async def crew_say(body: SayIn, profile: PlayerProfile = Me, db: AsyncSession = Db) -> dict[str, Any]:
    members, msg = await _run(ss.crew_say(db, profile.id, profile.display_name, body.text))
    for m in members:
        if m != profile.id:
            await manager.send_to_player(m, {"type": "social.crew", "payload": msg})
    return {"message": msg}


# ---- gifting
class GiftIn(BaseModel):
    to: str
    amount: int = 0
    item: str | None = None


@router.post("/gifts")
async def gift(body: GiftIn, profile: PlayerProfile = Me, db: AsyncSession = Db) -> dict[str, Any]:
    out = await _run(ss.gift(db, profile.id, body.to, body.amount, body.item))
    await manager.send_to_player(body.to, {"type": "social.gift", "payload": {"from": profile.id, "name": profile.display_name, **out}})
    return out
