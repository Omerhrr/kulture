# Architecture

## Principles (from the product spec)

1. **Authoritative server** — the backend owns player balances, inventory,
   jobs, prices, payment state, NPC permissions, and world persistence. The
   client renders and predicts; it never decides.
2. **Bitcoin integrity** — a Lightning invoice is a payment request, not
   proof of payment. Only the backend's independent verification against the
   node settles a payment.
3. **Separation of economies** — real sats, simulated NGN, and reputation
   are distinct asset classes, never silently convertible.
4. **Bounded AI** — DSH agents recommend and execute only permitted actions
   through validated tools. No LLM ever touches real money.
5. **Failure is safe** — timeouts, restarts, duplicated events and service
   failures never create unauthorized payments or duplicate rewards.

## Components

| Component | Tech | Authority |
|-----------|------|-----------|
| Nuxt Client | Nuxt 3, TresJS (Three.js), Pinia, Tailwind | none (presentation + input prediction) |
| FastAPI Game Server | FastAPI, SQLAlchemy 2 async, Pydantic v2 | gameplay validation, purchases, fulfillment |
| PostgreSQL / SQLite | SQLAlchemy portable models | durable source of truth |
| Lightning Adapter | `LightningAdapter` protocol | node communication + settlement verification |
| DSH Agent Runtime | tool registry + orchestrator | selects among allowed actions; backend enforces |
| Background Workers | asyncio loops on the outbox pattern | events, expiry, reconciliation, world events |
| LLM Bridge | Bun + z-ai-web-dev-sdk (OpenAI-compatible) | none (inference only; swappable for DeepSeek API) |

## Interaction flow (every player action)

1. Browser submits an action (REST or WS message).
2. FastAPI authenticates the JWT and validates the schema.
3. The service loads authoritative state and checks the rules (e.g. server-
   side distance for interactions, listing price/stock for purchases).
4. Durable state changes commit — or a pending operation is created
   (payment intents).
5. Payment-related communication goes through the Lightning adapter only.
6. Verified settlement events are persisted (append-only `payment_events`).
7. Fulfillment happens in one transaction, exactly once.
8. Domain events land in the **transactional outbox**; workers fan them out
   over WebSockets and trigger agents.
9. Agents are triggered by domain events, never per frame.

## Consistency model

- **Database**: transactional consistency for purchases, inventory, jobs,
  and payment fulfillment (atomic stock guard + status-transition guard).
- **Realtime**: WebSockets deliver notifications eventually; clients
  reconnect and call `state.resync` for the authoritative snapshot.
- **Agents**: asynchronous, bounded (≤ 4 actions/run, timeout), auditable
  (`agent_runs` + `agent_actions`), retry-safe.
- **Payments**: idempotent event processing via unique `provider_event_id`,
  plus periodic reconciliation against node state.

## Sandbox single-origin routing

The preview environment exposes ONE port. `scripts/gateway.js` (Node +
http-proxy) boots the whole stack and routes:

- `/api/*`, `/healthz` → FastAPI `:8000`
- `/ws/*` (upgrade) → FastAPI `:8000`
- everything else → Nuxt `:3001` (with a warm-up fallback page on :3000
  while upstreams boot)

In production, `infra/Caddyfile` performs the same routing inside Docker
Compose. Set `KK_NO_BOOTSTRAP=1` when an external supervisor owns the
services.
