<div align="center">

# 🛺 Kaduna Kulture

**A Living Kaduna. An Economy Powered by Bitcoin.**

A 3D browser-based life simulator with a Bitcoin Lightning-native economy.

</div>

---

## What is this?

Kaduna Kulture is a playable, persistent Kaduna city simulation. Players walk a
compact neighborhood inspired by Ali Akilu Road, take delivery jobs from an
**AI shopkeeper** (DSH-powered, with a full audit trail), and buy goods with
**real Bitcoin sats over Lightning** - where the backend independently verifies
settlement before delivering items exactly once.

This is a Bitcoin-native economy, not a conventional game with a crypto
balance bolted on: an invoice is a payment *request*, never proof of payment;
the authoritative server owns every sat, stock count, job, and price.

## Demo account

```
username: demo_player
password: kaduna-demo-2026
```

## The golden path (what to demo)

1. **Enter the world** - register or use the demo account.
2. **Walk** (WASD / arrows) to Musa's Provision Store and press **E**.
3. **Talk to Mallam Musa** - the DSH agent answers in character (LLM when
   available, deterministic fallback otherwise - both audited in the DB).
4. **Accept a delivery job** - pick up the sealed package, deliver it to
   Hajiya Amina at Stonetech Square → earn simulated NGN + reputation.
5. **Buy with Lightning** - pick an item, scan/copy the BOLT11 invoice (a
   real wallet would pay it on regtest), settle, and watch the backend
   verify settlement and deliver the item **exactly once**.
6. Watch **NEPA Wahala** and **Market Rush** world events change shop
   availability in real time.

> ⚠️ In this build, Lightning runs against a **regtest-style simulator**
> (structurally valid `lnbcrt` invoices, full state machine). No real funds
> move. The dev-only "simulate wallet payment" button stands in for an
> external wallet; it emits settlement events through the exact same
> idempotent pipeline a real node webhook would use.

## Architecture

```
Browser (Nuxt 3 + TresJS/Three.js)          no financial authority
        │  REST /api/v1  ·  WebSocket /ws/game
        ▼
FastAPI Game Server (authoritative)          owns balances, stock, jobs, prices
        │                    │
        ▼                    ▼
PostgreSQL (ledger of     Lightning Adapter (mock ⇄ LDK Node)
record, 18 tables)             │ verified settlement only
        ▲                    ▼
Outbox → Workers (WS fanout, agent triggers, expiry, reconciliation)
        │
DSH Agent Runtime - allowlisted tools, Pydantic-validated, bounded
        via OpenAI-compatible LLM (z-ai bridge / DeepSeek) + deterministic fallback
```

Details: [docs/architecture.md](docs/architecture.md) ·
[payment state machine](docs/payment-state-machine.md) ·
[Lightning integration](docs/lightning-integration.md) ·
[security model](docs/security.md)

## Repository layout

```
kaduna-kulture/
├── frontend/            # Nuxt 3 + TypeScript + TresJS + Tailwind + Pinia
│   └── app/             # pages/, components/{game,payments}/, stores/, composables/
├── backend/             # FastAPI + SQLAlchemy 2 async + Alembic + Pydantic v2
│   ├── app/             # api/, services/, payments/, agents/, workers/, models/
│   ├── alembic/         # versioned migrations
│   └── tests/           # pytest: payments, gameplay, agent tools
├── services/llm-bridge/ # OpenAI-compatible bridge over z-ai-web-dev-sdk (Bun)
├── scripts/             # gateway.js (single-origin router), smoke tests
├── infra/               # Caddyfile
├── docs/                # architecture, payments, security, runbooks
└── docker-compose.yml   # postgres + backend + frontend + caddy + bridge
```

## Quickstart (local, no Docker)

```bash
# 1. Backend (Python 3.12)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head                 # or skip: dev mode auto-creates tables
uvicorn app.main:app --port 8000     # world seeds itself on first boot

# 2. LLM bridge (optional - agent falls back to deterministic mode without it)
cd ../services/llm-bridge && bun install && bun bridge.ts   # :8100

# 3. Frontend
cd ../../frontend && bun install
bun run dev -- -p 3001               # devProxy sends /api + /ws to :8000
```

Open `http://localhost:3001`. For a single-origin setup (preview/production),
run the gateway instead: `node scripts/gateway.js` (serves everything on :3000).

## Tests

```bash
cd backend && pytest -q
```

Covers the spec's testing strategy: payment state transitions, duplicate
settlement idempotency, replay-safe purchases, concurrent purchases of the
last item, invoice expiry, reconciliation after missed notifications, job
lifecycle, server-side distance validation, and agent tool authorization
(prohibited tools are unregistered entirely).

## Docker

```bash
docker compose up --build
# Caddy serves the world on :80 - API on /api, WS on /ws
```

## Documentation

| Doc | Purpose |
|-----|---------|
| [docs/architecture.md](docs/architecture.md) | components, interaction flow, consistency model |
| [docs/gameplay.md](docs/gameplay.md) | world, economy rules, jobs, events |
| [docs/lightning-integration.md](docs/lightning-integration.md) | adapter interface, mock vs LDK, lifecycle |
| [docs/payment-state-machine.md](docs/payment-state-machine.md) | the 10-step purchase flow + guarantees |
| [docs/security.md](docs/security.md) | threat model, controls, compliance boundary |
| [docs/development-setup.md](docs/development-setup.md) | environments, migrations, troubleshooting |
| [docs/demo-runbook.md](docs/demo-runbook.md) | step-by-step demo script + fallback plan |

## License

MIT - see [LICENSE](LICENSE).
