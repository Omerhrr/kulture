"""Agent tool registry - the permission boundary for every DSH action.

Each tool has:
- a Pydantic input schema (invalid inputs are rejected before execution)
- a bounds check (economic limits the LLM cannot negotiate around)
- an async handler executed against authoritative services

Prohibited capabilities from the spec (transfer_player_sats,
withdraw_bitcoin, change_payment_status, ...) are NOT REGISTERED AT ALL -
and additionally the orchestrator double-checks every requested tool
against the agent's allowlist before execution (defense in depth).
"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import NPCAgent
from app.models.business import Business, ShopListing
from app.models.catalog import Item
from app.models.jobs import Job
from app.models.player import PlayerProfile
from app.models.world import WorldEntity

JOB_REWARD_CAP_NGN_MINOR = 50_000_00      # a single job can never pay more than ₦50,000
MAX_OPEN_JOBS_PER_BUSINESS = 6
PRICE_DELTA_MAX_PERCENT = 25              # ±25% price corridor
MIN_LISTING_PRICE_NGN = 50_00
MIN_LISTING_SATS = 100


class ToolRejected(Exception):
    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


# ---------------------------------------------------------------- schemas
class BusinessStatusIn(BaseModel):
    pass


class CheckInventoryIn(BaseModel):
    pass


class MarketPricesIn(BaseModel):
    item_code: str | None = None


class CustomerContextIn(BaseModel):
    player_id: str = Field(min_length=8, max_length=36)


class ListJobsIn(BaseModel):
    pass


class CreateDeliveryJobIn(BaseModel):
    item_code: str = Field(min_length=2, max_length=64)
    dropoff_entity_code: str = Field(min_length=2, max_length=64)
    reward_ngn_minor: int = Field(ge=0, le=JOB_REWARD_CAP_NGN_MINOR)
    title: str = Field(min_length=3, max_length=80)
    expires_minutes: int = Field(default=240, ge=15, le=1440)

    @field_validator("title")
    @classmethod
    def clean_title(cls, v: str) -> str:
        return v.strip()


class SetPriceIn(BaseModel):
    listing_id: str = Field(min_length=8, max_length=36)
    new_price_ngn_minor: int | None = Field(default=None, ge=MIN_LISTING_PRICE_NGN)
    new_price_sats: int | None = Field(default=None, ge=MIN_LISTING_SATS)


class RecordInteractionIn(BaseModel):
    player_id: str = Field(min_length=8, max_length=36)
    summary: str = Field(min_length=2, max_length=280)


@dataclass(slots=True)
class ToolSpec:
    name: str
    description: str
    input_model: type[BaseModel]
    side_effect: bool
    handler: Callable[..., Awaitable[dict[str, Any]]]


def _input_hash(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


# --------------------------------------------------------------- handlers
async def _get_business(db: AsyncSession, agent: NPCAgent) -> Business:
    biz = (
        await db.execute(select(Business).where(Business.id == agent.business_id))
    ).unique().scalar_one_or_none() if agent.business_id else None
    if not biz:
        raise ToolRejected("agent_has_no_business")
    return biz


async def _get_player(db: AsyncSession, player_id: str) -> PlayerProfile:
    p = (
        await db.execute(select(PlayerProfile).where(PlayerProfile.id == player_id))
    ).scalar_one_or_none()
    if not p:
        raise ToolRejected("player_not_found")
    return p


async def _t_business_status(db: AsyncSession, agent: NPCAgent, **_: Any) -> dict[str, Any]:
    biz = await _get_business(db, agent)
    listings = (
        await db.execute(select(ShopListing).where(ShopListing.business_id == biz.id))
    ).scalars().all()
    return {
        "name": biz.name,
        "status": biz.status,
        "active_listings": sum(1 for l in listings if l.is_active),
        "units_in_stock": sum(l.quantity_available for l in listings),
        "out_of_stock_lines": sum(1 for l in listings if l.quantity_available == 0),
    }


async def _t_check_inventory(db: AsyncSession, agent: NPCAgent, **_: Any) -> dict[str, Any]:
    biz = await _get_business(db, agent)
    rows = (
        await db.execute(
            select(ShopListing, Item)
            .join(Item, Item.id == ShopListing.item_id)
            .where(ShopListing.business_id == biz.id)
        )
    ).all()
    return {
        "items": [
            {
                "item_code": item.code,
                "name": item.name,
                "quantity_available": listing.quantity_available,
                "price_sats": listing.price_sats,
                "price_ngn_minor": listing.price_ngn_minor,
            }
            for listing, item in rows
        ]
    }


async def _t_market_prices(db: AsyncSession, agent: NPCAgent, item_code: str | None = None, **_: Any) -> dict[str, Any]:
    q = (
        select(ShopListing, Item)
        .join(Item, Item.id == ShopListing.item_id)
        .where(ShopListing.is_active.is_(True))
    )
    if item_code:
        q = q.where(Item.code == item_code)
    rows = (await db.execute(q.limit(40))).all()
    return {
        "prices": [
            {"business_code": listing.business_id[:8], "item_code": item.code,
             "name": item.name, "price_sats": listing.price_sats,
             "price_ngn_minor": listing.price_ngn_minor}
            for listing, item in rows
        ]
    }


async def _t_customer_context(db: AsyncSession, agent: NPCAgent, player_id: str, **_: Any) -> dict[str, Any]:
    player = await _get_player(db, player_id)
    return {
        "display_name": player.display_name,
        "reputation": player.reputation,
        "member_since": player.created_at.isoformat() if player.created_at else None,
    }


async def _t_list_jobs(db: AsyncSession, agent: NPCAgent, **_: Any) -> dict[str, Any]:
    biz = await _get_business(db, agent)
    jobs = (
        await db.execute(
            select(Job).where(Job.issuer_business_id == biz.id, Job.status == "available")
        )
    ).scalars().all()
    return {
        "open_jobs": [
            {"code": j.code, "title": j.title, "reward_ngn_minor": j.reward_ngn_minor}
            for j in jobs
        ],
        "open_job_count": len(jobs),
    }


async def _t_create_delivery_job(
    db: AsyncSession, agent: NPCAgent, item_code: str, dropoff_entity_code: str,
    reward_ngn_minor: int, title: str, expires_minutes: int = 240, **_: Any
) -> dict[str, Any]:
    biz = await _get_business(db, agent)
    open_count = len(
        (
            await db.execute(
                select(Job).where(Job.issuer_business_id == biz.id, Job.status == "available")
            )
        ).scalars().all()
    )
    if open_count >= MAX_OPEN_JOBS_PER_BUSINESS:
        raise ToolRejected("max_open_jobs_reached")

    item = (
        await db.execute(select(Item).where(Item.code == item_code))
    ).scalar_one_or_none()
    if not item:
        raise ToolRejected("unknown_item_code")
    dropoff = (
        await db.execute(select(WorldEntity).where(WorldEntity.code == dropoff_entity_code))
    ).scalar_one_or_none()
    if not dropoff:
        raise ToolRejected("unknown_dropoff_entity")

    job = Job(
        code=f"deliv-{uuid.uuid4().hex[:10]}",
        job_type="delivery",
        title=title[:80],
        description=f"Deliver {item.name} from {biz.name} to {dropoff.name}.",
        issuer_business_id=biz.id,
        status="available",
        pickup_entity_id=biz.entity_id,
        dropoff_entity_id=dropoff.id,
        reward_ngn_minor=int(reward_ngn_minor),
        reward_reputation=5,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=expires_minutes),
    )
    db.add(job)
    return {"job_code": job.code, "reward_ngn_minor": job.reward_ngn_minor}


async def _t_set_price(
    db: AsyncSession, agent: NPCAgent, listing_id: str,
    new_price_ngn_minor: int | None = None, new_price_sats: int | None = None, **_: Any
) -> dict[str, Any]:
    biz = await _get_business(db, agent)
    listing = (
        await db.execute(
            select(ShopListing).where(
                ShopListing.id == listing_id, ShopListing.business_id == biz.id
            )
        )
    ).scalar_one_or_none()
    if not listing:
        raise ToolRejected("listing_not_owned_by_business")

    changes: dict[str, int] = {}
    if new_price_ngn_minor is not None:
        lo = max(MIN_LISTING_PRICE_NGN, listing.price_ngn_minor * (100 - PRICE_DELTA_MAX_PERCENT) // 100)
        hi = listing.price_ngn_minor * (100 + PRICE_DELTA_MAX_PERCENT) // 100
        if not (lo <= new_price_ngn_minor <= hi):
            raise ToolRejected(
                f"price_out_of_corridor_{lo}_to_{hi}"
            )
        listing.price_ngn_minor = new_price_ngn_minor
        changes["price_ngn_minor"] = new_price_ngn_minor
    if new_price_sats is not None:
        lo = max(MIN_LISTING_SATS, listing.price_sats * (100 - PRICE_DELTA_MAX_PERCENT) // 100)
        hi = listing.price_sats * (100 + PRICE_DELTA_MAX_PERCENT) // 100
        if not (lo <= new_price_sats <= hi):
            raise ToolRejected(f"sats_price_out_of_corridor_{lo}_to_{hi}")
        listing.price_sats = new_price_sats
        changes["price_sats"] = new_price_sats
    if not changes:
        raise ToolRejected("no_price_change_requested")
    listing.version += 1
    return {"listing_id": listing.id, **changes}


async def _t_record_interaction(
    db: AsyncSession, agent: NPCAgent, player_id: str, summary: str, **_: Any
) -> dict[str, Any]:
    await _get_player(db, player_id)
    cfg = dict(agent.configuration or {})
    log: list[dict] = list(cfg.get("interaction_log", []))
    log.append({"player_id": player_id, "summary": summary[:280],
                "at": datetime.now(timezone.utc).isoformat()})
    agent.configuration = {**cfg, "interaction_log": log[-50:]}  # bounded history
    return {"recorded": True}


# ---------------------------------------------------------------- registry
def build_default_tools() -> dict[str, ToolSpec]:
    specs = [
        ToolSpec("get_business_status", "Read this business's operating status (open/closed, stock levels).",
                 BusinessStatusIn, False, _t_business_status),
        ToolSpec("check_inventory", "List stock levels and prices for this business.",
                 CheckInventoryIn, False, _t_check_inventory),
        ToolSpec("get_market_prices", "Compare current market prices across businesses.",
                 MarketPricesIn, False, _t_market_prices),
        ToolSpec("get_customer_context", "Read a customer's display name and reputation.",
                 CustomerContextIn, False, _t_customer_context),
        ToolSpec("list_available_jobs", "List open delivery jobs this business has posted.",
                 ListJobsIn, False, _t_list_jobs),
        ToolSpec("create_delivery_job", "Post a new delivery job (bounded reward, bounded count).",
                 CreateDeliveryJobIn, True, _t_create_delivery_job),
        ToolSpec("set_price_within_limits", "Adjust one of this business's listing prices within a ±25% corridor.",
                 SetPriceIn, True, _t_set_price),
        ToolSpec("record_customer_interaction", "Append a short note about a customer interaction.",
                 RecordInteractionIn, True, _t_record_interaction),
    ]
    return {s.name: s for s in specs}


TOOL_REGISTRY: dict[str, ToolSpec] = build_default_tools()


def validate_tool_request(agent: NPCAgent, tool_name: str, payload: dict) -> dict:
    """Validate allowlist + schema. Returns parsed input. Raises ToolRejected."""
    if tool_name not in TOOL_REGISTRY:
        raise ToolRejected("tool_does_not_exist")
    if tool_name not in (agent.allowed_tools or []):
        raise ToolRejected("tool_not_allowed_for_agent")
    try:
        parsed = TOOL_REGISTRY[tool_name].input_model(**(payload or {}))
    except Exception as exc:  # pydantic ValidationError or TypeError
        raise ToolRejected(f"invalid_input: {exc}") from exc
    return parsed.model_dump(exclude_none=True)


def input_digest(payload: dict) -> str:
    return _input_hash(payload or {})


def tool_catalog_for_prompt(allowed: list[str]) -> list[dict]:
    return [
        {"name": s.name, "description": s.description,
         "input_schema": s.input_model.model_json_schema()}
        for name, s in TOOL_REGISTRY.items()
        if name in allowed
    ]
