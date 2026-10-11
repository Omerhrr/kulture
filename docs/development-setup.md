# Development Setup

## Environments

| Env | DB | Lightning | Notes |
|-----|-----|-----------|-------|
| local | SQLite (default) | mock regtest simulator | zero-config; world self-seeds |
| test | SQLite file per run | mock | `pytest -q` |
| staging/prod | PostgreSQL (asyncpg) | mock or ldk_node | Alembic migrations only |

Configuration is environment-driven (`KK_*` prefix) - see `.env.example`.

## Local quickstart

```bash
# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000 --reload     # seeds world on first boot

# migrations (explicit, versioned)
alembic upgrade head
alembic revision --autogenerate -m "change"   # review before commit!

# llm bridge (optional)
cd ../services/llm-bridge && bun install && bun bridge.ts

# frontend
cd ../../frontend && bun install
bun run dev -- -p 3001                        # devProxy → :8000 for /api + /ws
```

Single origin (like the sandbox preview): `node scripts/gateway.js` → :3000.

## Migrations policy

Versioned Alembic migrations only - never rely on runtime schema mutation in
staging/production. (`create_all` in the app lifespan is a dev convenience
and is idempotent; Alembic remains the source of truth.)

Generate on SQLite OR Postgres - models are portable (String UUIDs, JSON,
BigInteger minor units, no vendor-specific types).

## Sandbox specifics (this repo's preview)

- The platform runs `bun run dev` at the repo root → `scripts/gateway.js`,
  which self-bootstraps backend (:8000), LLM bridge (:8100), Nuxt (:3001),
  then serves everything on :3000 (boot page while warming up).
- Mini-services under `/home/z/my-project/mini-services/` are the sanctioned
  per-service launchers (package.json + run.sh each).
- `KK_NO_BOOTSTRAP=1` disables gateway self-bootstrap when a supervisor owns
  the services.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| 503 `backend_booting` | FastAPI still starting; retry in a few seconds |
| Boot page on `/` forever | check `/tmp/kk-gateway.log`, `/tmp/nuxt-dev.log`, `/tmp/kk-backend.log` |
| WS drops | client auto-reconnects with backoff + `state.resync`; verify `/ws/game` upgrade through the proxy |
| "power outage" blocks purchase | NEPA Wahala event - wait ~100 s or restart backend |
| Agent replies with scripted fallback | LLM bridge down or `KK_LLM_ENABLED=false`; deterministic mode is by design |
| Reset the world | delete `backend/kaduna.db` and restart (dev only!) |

## Smoke tests

```bash
bash scripts/../scripts  # see kaduna-kulture/scripts/
node scripts/ws-smoke.mjs         # WS + DSH agent end-to-end
# REST smoke: see scripts/kk-smoke.sh flow documented in docs/demo-runbook.md
```
