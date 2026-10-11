# Contributing

Kaduna Kulture is open-source-first: the Bitcoin integration, tests,
architecture, and contribution workflow are part of the product.

## Ground rules

1. **One vertical slice at a time** — complete a working slice before
   expanding horizontally.
2. **Payments are sacred** — any PR touching `app/payments/` must include
   tests for idempotency, duplicate settlement, and amount verification.
3. **The adapter is the boundary** — no Lightning/node code outside
   `app/payments/`. No LLM calls outside `app/agents/`.
4. **Agents are bounded** — new tools need: a Pydantic input schema, economic
   bounds, allowlist registration, and tests proving rejection paths.
5. **Asset classes never mix** — real sats, simulated NGN, and reputation are
   separate; conversions are forbidden by design.
6. **Document decisions** that affect payments, custody, or persistent state.

## Workflow

```bash
# 1. branch
git checkout -b feat/my-slice

# 2. develop (backend tests must pass)
cd backend && pytest -q
cd ../frontend && bun run dev -- -p 3001

# 3. migrations
alembic revision --autogenerate -m "..."   # review the generated file!
```

## Definition of done (from the spec)

- Code committed and documented.
- Validation and authorization implemented.
- Relevant tests pass; failure cases handled.
- Logs contain no sensitive information.
- The feature works from the actual UI.
- No undocumented manual interventions.
