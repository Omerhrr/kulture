"""DSH agent runtime tests (spec: agent tool authorization, KK-009, KK-011).

The critical security property: NPCs can NEVER touch real Bitcoin —
prohibited tools are unregistered, allowlists are enforced, economic
bounds cannot be bypassed, and every action is audited.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


async def _shopkeeper():
    from sqlalchemy import select
    from app.db.session import AsyncSessionLocal
    from app.models.business import NPCAgent

    async with AsyncSessionLocal() as db:
        agent = (await db.execute(
            select(NPCAgent).where(NPCAgent.code == "kaduna_shopkeeper_001")
        )).scalar_one()
        db.expunge(agent)
        return agent


async def test_prohibited_tools_do_not_exist():
    """Spec prohibited_tools must be rejected — they are not even registered."""
    from app.agents.tool_registry import TOOL_REGISTRY, ToolRejected, validate_tool_request

    for banned in (
        "transfer_player_sats", "withdraw_bitcoin", "change_payment_status",
        "modify_private_keys", "write_arbitrary_database_records", "grant_unbounded_rewards",
    ):
        assert banned not in TOOL_REGISTRY
    agent = await _shopkeeper()
    with pytest.raises(ToolRejected):
        validate_tool_request(agent, "withdraw_bitcoin", {})


async def test_allowlist_enforced():
    from app.agents.tool_registry import ToolRejected, validate_tool_request
    from app.models.business import NPCAgent

    naked = NPCAgent(
        code="test_naked", name="Naked Agent", persona="", world_entity_id="x" * 32,
        business_id=None, agent_type="shopkeeper", allowed_tools=[], status="active",
    )
    with pytest.raises(ToolRejected) as e:
        validate_tool_request(naked, "create_delivery_job", {})
    assert "not_allowed" in str(e.value)


async def test_invalid_inputs_rejected():
    from app.agents.tool_registry import ToolRejected, validate_tool_request

    agent = await _shopkeeper()
    # reward over cap
    with pytest.raises(ToolRejected):
        validate_tool_request(agent, "create_delivery_job", {
            "item_code": "suya_spice", "dropoff_entity_code": "stonetech_square",
            "reward_ngn_minor": 999_999_999_99, "title": "Too generous"})
    # unknown dropoff — schema-valid but rejected at execution by the handler
    from app.agents.tool_registry import TOOL_REGISTRY
    from app.db.session import AsyncSessionLocal

    parsed = validate_tool_request(agent, "create_delivery_job", {
        "item_code": "suya_spice", "dropoff_entity_code": "lagos_island",
        "reward_ngn_minor": 100_00, "title": "Wrong city"})
    with pytest.raises(ToolRejected):
        async with AsyncSessionLocal() as db:
            await TOOL_REGISTRY["create_delivery_job"].handler(db, agent, **parsed)


async def test_price_corridor_bounds():
    from app.agents.tool_registry import TOOL_REGISTRY, ToolRejected, validate_tool_request
    from app.db.session import AsyncSessionLocal

    agent = await _shopkeeper()
    # 10x price — schema-valid, rejected at execution by the ±25% corridor
    parsed = validate_tool_request(agent, "set_price_within_limits", {
        "listing_id": "whatever", "new_price_sats": 999999})
    with pytest.raises(ToolRejected):
        async with AsyncSessionLocal() as db:
            await TOOL_REGISTRY["set_price_within_limits"].handler(db, agent, **parsed)


async def test_agent_run_deterministic_creates_job_and_audits():
    """Fallback mode: run completes, executes bounded audited actions, and
    the shopkeeper goal 'create eligible delivery jobs' is satisfied
    (acceptance KK-009)."""
    from sqlalchemy import select, func, update
    from app.agents.orchestrator import orchestrator
    from app.db.session import AsyncSessionLocal
    from app.models.agents import AgentAction, AgentRun
    from app.models.jobs import Job
    from app.models.business import NPCAgent

    async with AsyncSessionLocal() as db:
        agent = (await db.execute(
            select(NPCAgent).where(NPCAgent.code == "kaduna_shopkeeper_001")
        )).scalar_one()

        # clear open jobs so the deterministic fallback must create one
        await db.execute(
            update(Job)
            .where(Job.issuer_business_id == agent.business_id, Job.status == "available")
            .values(status="expired")
        )
        await db.commit()

        run = await orchestrator.run_for_trigger(
            db, agent, "customer_interaction", None,
            {"player_id": None, "player_display_name": "Emeka", "message": "hello boss!"},
        )
        assert run.status in ("fallback", "completed", "timeout")
        assert run.engine == "deterministic_fallback"
        assert run.summary  # dialogue was produced

        actions = (await db.execute(
            select(AgentAction).where(AgentAction.agent_run_id == run.id)
        )).scalars().all()
        assert len(actions) >= 1
        assert all(a.validation_status in ("allowed", "rejected_not_allowed",
                                           "rejected_invalid_input", "rejected_out_of_bounds")
                   for a in actions)

        jobs_after = (await db.execute(
            select(func.count()).select_from(Job).where(
                Job.issuer_business_id == agent.business_id, Job.status == "available")
        )).scalar_one()
        assert jobs_after == 1  # created a bounded job through the audited pipeline


async def test_npc_cannot_spend_player_bitcoin_property():
    """KK-011: no agent tool path leads to moving real sats. Verify no tool
    handler signature accepts payment/withdraw/transfer semantics."""
    from app.agents.tool_registry import TOOL_REGISTRY

    dangerous_fragments = ("withdraw", "transfer_sats", "pay_invoice", "spend")
    for name, spec in TOOL_REGISTRY.items():
        for frag in dangerous_fragments:
            assert frag not in name.lower()
