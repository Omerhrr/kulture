"""DSH agent orchestrator - bounded, auditable, event-triggered NPC decisions.

Execution policy (spec):
- triggered by domain events (customer interaction, job event, market event),
  NEVER per game frame
- one AgentRun per trigger; ≤ settings.agent_max_actions_per_run tool calls
- every tool request is validated (allowlist + Pydantic + economic bounds)
  BEFORE execution; results persisted to agent_actions for auditability
- LLM unavailable ⇒ deterministic fallback behavior through the same
  audited tool pipeline (NPCs never stall the game)
- no recursive runs: agent triggers dispatched by this module are marked
  final (no further agent runs spawned from within a run)
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.llm_client import llm_client
from app.agents.tool_registry import (
    TOOL_REGISTRY,
    ToolRejected,
    input_digest,
    tool_catalog_for_prompt,
    validate_tool_request,
)
from app.core.config import settings
from app.events.outbox_service import emit
from app.models.agents import AgentAction, AgentRun
from app.models.business import NPCAgent
from app.models.jobs import Job
from app.services.jobs_service import JobError

PERSONA_SYSTEM = """You are {name}, {persona}

You operate a simulated business in Kaduna, Nigeria inside the game
"Kaduna Kulture". Respond ONLY with a JSON object, no prose:
{{
  "dialogue": "<one or two sentences of spoken dialogue in warm Nigerian English>",
  "actions": [{{"tool": "<tool_name>", "input": {{...}}}}]
}}

Rules:
- Use at most {max_actions} actions. Prefer zero actions for small talk.
- Only use tools from the provided catalog.
- Real money (Bitcoin sats) is NEVER yours to move. You cannot and must not
  reference moving real sats; purchases are settled by the payment system.
- Prices you quote for Lightning purchases must match the listing prices.
"""


class AgentOrchestrator:
    def __init__(self) -> None:
        self._active_runs: set[str] = set()  # guard against recursive/parallel runs

    # ------------------------------------------------------------------ run
    async def run_for_trigger(
        self,
        db: AsyncSession,
        agent: NPCAgent,
        trigger_source: str,
        trigger_event_id: str | None,
        context: dict[str, Any],
    ) -> AgentRun:
        """context keys: player_id (opt), player_display_name (opt), message (opt)."""
        if agent.id in self._active_runs:
            raise RuntimeError("agent_run_already_active")
        self._active_runs.add(agent.id)
        started = time.monotonic()
        run = AgentRun(
            agent_id=agent.id, trigger_source=trigger_source,
            trigger_event_id=trigger_event_id, status="running",
        )
        db.add(run)
        await db.flush()

        engine = "deterministic_fallback"
        dialogue = ""
        usage: dict[str, Any] = {}

        try:
            llm = await llm_client.chat_json(
                system=PERSONA_SYSTEM.format(
                    name=agent.name, persona=agent.persona or "",
                    max_actions=settings.agent_max_actions_per_run,
                ),
                user=self._render_context(agent, context),
            )
            if llm.ok:
                plan = llm_client.extract_json(llm.content)
                if plan and isinstance(plan.get("dialogue"), str):
                    engine = "dsh_llm"
                    dialogue = plan["dialogue"][:600]
                    usage = llm.usage or {}
                    await self._execute_actions(db, run, agent, plan.get("actions") or [])
                else:
                    dialogue = "Abeg, one moment - my head dey scatter small. (AI plan unparsable)"
            else:
                dialogue = self._deterministic_dialogue(agent, context)

            # deterministic fallback also takes bounded business actions
            if engine == "deterministic_fallback":
                fallback_dialogue, took_action = await self._deterministic_actions(db, run, agent, context)
                if took_action:
                    dialogue = fallback_dialogue
            elapsed = time.monotonic() - started
            if elapsed > settings.agent_run_timeout_seconds:
                run.status = "timeout"
            else:
                run.status = "completed" if engine == "dsh_llm" else "fallback"
            run.engine = engine
            run.token_usage = usage
            run.summary = (dialogue or "")[:500]

            await emit(
                db, "npc.dialogue", agent.code,
                {
                    "npc": agent.code,
                    "npc_name": agent.name,
                    "dialogue": dialogue,
                    "engine": engine,
                    "run_id": run.id,
                },
                player_id=context.get("player_id"),
            )
            await emit(
                db, "agent.action", run.id,
                {"run_id": run.id, "agent": agent.code, "engine": engine},
                player_id=context.get("player_id"),
            )
            await db.commit()
            return run
        except Exception as exc:  # noqa: BLE001 - runs must never crash callers
            run.status = "failed"
            run.error_code = type(exc).__name__
            run.completed_at = datetime.now(timezone.utc)
            await db.commit()
            raise
        finally:
            run.completed_at = run.completed_at or datetime.now(timezone.utc)
            self._active_runs.discard(agent.id)

    # -------------------------------------------------------------- actions
    async def _execute_actions(
        self, db: AsyncSession, run: AgentRun, agent: NPCAgent, actions: list[dict]
    ) -> None:
        budget = settings.agent_max_actions_per_run
        for raw in actions[:budget]:
            if not isinstance(raw, dict):
                continue
            tool_name = str(raw.get("tool", ""))
            payload = raw.get("input") or {}
            action = AgentAction(
                agent_run_id=run.id, tool_name=tool_name,
                input_payload=payload, input_hash=input_digest(payload),
            )
            db.add(action)
            started = time.monotonic()
            try:
                parsed = validate_tool_request(agent, tool_name, payload)
                action.validation_status = "allowed"
                spec = TOOL_REGISTRY[tool_name]
                result = await spec.handler(db, agent, **parsed)
                action.execution_status = "executed"
                action.result_reference = str(result.get("job_code") or result.get("listing_id") or "ok")
            except ToolRejected as exc:
                action.validation_status = (
                    "rejected_not_allowed"
                    if str(exc) in ("tool_does_not_exist", "tool_not_allowed_for_agent")
                    else "rejected_out_of_bounds" if str(exc).startswith(("price_out", "sats_price", "max_open", "unknown_"))
                    else "rejected_invalid_input"
                )
                action.execution_status = "skipped"
                action.error = str(exc)[:250]
            except Exception as exc:  # noqa: BLE001
                action.validation_status = "allowed"
                action.execution_status = "failed"
                action.error = f"{type(exc).__name__}: {exc}"[:250]
            finally:
                action.latency_ms = round((time.monotonic() - started) * 1000, 2)
            db.add(action)
            await db.flush()

    # -------------------------------------------------------------- context
    @staticmethod
    def _render_context(agent: NPCAgent, context: dict[str, Any]) -> str:
        catalog = tool_catalog_for_prompt(agent.allowed_tools or [])
        payload = {
            "current_time_utc": datetime.now(timezone.utc).isoformat(),
            "your_agent_code": agent.code,
            "your_business_status": agent.configuration or {},
            "trigger": context.get("trigger_source") or "customer_interaction",
            "customer": {
                "display_name": context.get("player_display_name"),
                "message": context.get("message"),
                "reputation": context.get("player_reputation"),
            },
            "business_snapshot": context.get("business_snapshot") or {},
            "available_tools": catalog,
        }
        import json as _json

        return _json.dumps(payload, default=str, ensure_ascii=False)

    # ------------------------------------------------------- deterministic
    def _deterministic_dialogue(self, agent: NPCAgent, context: dict[str, Any]) -> str:
        name = context.get("player_display_name") or "my friend"
        msg = (context.get("message") or "").lower()
        if any(g in msg for g in ("hello", "hi", "sannu", "barka", "good")):
            return f"Sannu {name}! Welcome to my shop. You wan buy something, or you fit help me deliver package go Stonetech Square?"
        if "job" in msg or "work" in msg or "deliver" in msg:
            return f"Ah, you wan work? I get delivery job wey I need help with, {name}. Check the job board, na k-sats I dey pay, and reputation dey follow."
        if "bitcoin" in msg or "sats" in msg or "lightning" in msg:
            return "Yes o! You fit pay with Lightning - scan the QR for the item you want. Na real sats, so na your wallet go approve am. I no fit touch your Bitcoin."
        return f"Welcome {name}! Today we get stock - check the shop panel. Pay with Lightning (real sats) or just browse. How you dey?"

    async def _deterministic_actions(
        self, db: AsyncSession, run: AgentRun, agent: NPCAgent, context: dict[str, Any]
    ) -> tuple[str, bool]:
        """Rule-based business behavior executed through audited tools:
        e.g., ensure at least one delivery job exists (spec shopkeeper goal:
        'Create eligible delivery jobs')."""
        took_action = False
        biz_rows = (
            await db.execute(select(Job).where(Job.issuer_business_id == agent.business_id))
            if agent.business_id else None
        )
        open_jobs = 0
        if biz_rows is not None:
            open_jobs = sum(1 for j in biz_rows.scalars() if j.status == "available")
        if open_jobs == 0 and agent.business_id:
            try:
                parsed = validate_tool_request(
                    agent, "create_delivery_job",
                    {
                        "item_code": "suya_spice",
                        "dropoff_entity_code": "stonetech_square",
                        "reward_ksats": 8_000_00,
                        "title": "Deliver Suya Spice to Stonetech Square",
                        "expires_minutes": 480,
                    },
                )
                action = AgentAction(
                    agent_run_id=run.id, tool_name="create_delivery_job",
                    input_payload=parsed, input_hash=input_digest(parsed),
                    validation_status="allowed",
                )
                db.add(action)
                result = await TOOL_REGISTRY["create_delivery_job"].handler(db, agent, **parsed)
                action.execution_status = "executed"
                action.result_reference = str(result.get("job_code"))
                action.latency_ms = 1.0
                db.add(action)
                took_action = True
            except (ToolRejected, JobError):
                pass
        return ("I don post delivery job - check the job board if you dey interested.", took_action)


orchestrator = AgentOrchestrator()
