# Security Model

## Threat model → controls

| Threat | Control |
|--------|---------|
| Forged payment notifications | Settlement is only processed after independent adapter verification; unique `provider_event_id`; no client-confirm endpoint exists |
| Duplicate payment event delivery | Unique constraint + intent status-transition guard ⇒ exactly-once fulfillment |
| Replay of purchase requests | Mandatory idempotency key (UNIQUE) returns the original intent |
| Inventory race conditions | Atomic stock decrement inside the fulfillment transaction; loser → `reconciliation_required` |
| Unauthorized state modification | JWT auth on every private resource; server-side distance/stock/price validation; client never sends amounts |
| Compromised AI tool calls | Allowlist + Pydantic schema validation + economic bounds before execution; prohibited tools (spend/withdraw/transfer) are not registered at all; full audit in `agent_runs`/`agent_actions` |
| Stolen credentials | PBKDF2-HMAC-SHA256 (390k iterations); short-lived JWTs; rate limiting on auth/payment/interaction endpoints |
| Lightning node compromise | Node behind the adapter only; dev/prod config separated; never expose admin APIs; secrets never in app tables or logs |
| Secrets leaked through logs | Redacted structured logs; secrets only in env; uniform error envelope hides stack traces |
| Economic manipulation & bots | Server-side rate limits (movement 20 Hz, interactions 2/s, bounded agent budgets), stock guards, bounded job creation |

## Authentication

- `POST /auth/register|login` → JWT (HS256, 12 h) with player id claim.
- Passwords: PBKDF2-HMAC-SHA256, 390,000 iterations, per-user salt.
- Every `/players/me*`, `/purchases*`, `/payment-intents*`, `/jobs/*` route
  requires a valid token and resolves the profile server-side.

## Data integrity rules (enforced by schema)

- Money in integer minor units (sats / kobo) - never floats.
- UNIQUE: `payment_intents.idempotency_key`, `lightning_invoices.payment_hash`,
  `payment_events.provider_event_id`, `users.username`.
- Immutable payment history: `payment_events` is append-only.
- Optimistic concurrency (`version`) on inventories and listings.
- No seed phrases or private keys in any application table.

## Financial & compliance boundary (spec-mandated honesty)

- **Custody**: users pay individual invoices from their own wallets; the game
  holds no user balances and cannot spend user funds. NPCs cannot spend
  player Bitcoin (no such tool exists).
- **A technical prototype is not legal authorization.** Before accepting
  meaningful real-money volume: assess Nigerian payment-service / virtual-
  asset requirements, custody/exchange/cash-out implications, privacy and
  data-protection obligations, and obtain professional advice.
- Withdrawals, deposits, player-to-player transfers, and cash-out are
  deliberately out of scope for the MVP.

## Movement authority (P1 - implemented)

The server owns the player position end to end:

- **Speed envelope** - every WS `player.move` is reconciled against the
  server's last accepted position: a move may advance the player at most
  `movement_max_speed_units_per_s * dt` (dt capped at 1 s). Teleport attempts
  are clamped along the direction of travel and reported back to the client
  via `player.position_corrected` (the avatar snaps to the authoritative
  position). Dropped over-rate messages do not accumulate allowance.
- **Session seeding** - the WS session position is seeded from the stored
  `player_states` row on connect and persists across reconnects; a fresh
  session cannot reset the server's idea of where the player is.
- **REST interactions** - `POST /interactions` validates distance against the
  SERVER-stored position, never the request body (`body.position` is accepted
  for protocol compatibility only). Fabricated proximity returns 422.
- **Persistence** - positions are written at ≤2 writes/s per mover
  (`movement_persist_interval_seconds=0.5`), with flushes on `state.resync`
  and disconnect, so REST validation and reconnect seeds are never stale.
- Kill-switch: `KK_INTERACTIONS_USE_SERVER_POSITION=false` restores legacy
  behavior (not recommended).

## Authentication & CSRF strategy (P1 - implemented)

- Bearer JWT only. **No cookie sessions** - the API has no CSRF surface
  because no browser-attached credential exists. `tests/test_auth_no_cookies.py`
  locks this invariant (register/login/authenticated GET must never `Set-Cookie`).
- If cookie sessions are ever introduced they MUST ship with SameSite=Strict,
  a double-submit CSRF token bound to the session, and Origin/Referer checks
  on state-changing routes - enforced by a review checklist, not hope.

## Real-node webhook authentication (P1 - implemented)

`POST /api/v1/payments/webhook` accepts settlement notifications from a real
Lightning node behind three transport-auth layers:

1. `Authorization: Bearer <KK_WEBHOOK_BEARER>` (constant-time compare)
2. `X-KK-Signature` = HMAC-SHA256(`KK_WEBHOOK_SECRET`, `"{timestamp}.{raw_body}")`
3. `X-KK-Timestamp` within ±`KK_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS` (anti-replay)

The endpoint is disabled (503) until both secrets are configured. Application
security is unchanged and independent: the event still flows through
`process_settlement`, which re-verifies against the adapter and enforces
exactly-once fulfillment - a stolen or replayed webhook can never deliver
items twice. See docs/lightning-integration.md for the LDK wiring.

## Supply-chain & secrets operations (P1 - implemented)

- **CI scanning** - `.github/workflows/ci.yml` runs on every push/PR:
  backend pytest + `pip-audit` (advisory until first triage), frontend
  frozen-lockfile production build, and a gitleaks secret scan.
- **Secret rotation runbook** -
  1. Generate: `python -c "import secrets; print(secrets.token_urlsafe(48))"`
  2. Set `KK_JWT_SECRET` (or `KK_WEBHOOK_SECRET` / `KK_WEBHOOK_BEARER`) in the
     deployment env - never in code or `.env` committed to git.
  3. Rolling restart. JWT rotation invalidates all sessions (players re-login;
     WS clients auto-reconnect and resync). Webhook secret rotation must be
     coordinated with the node operator (support dual acceptance briefly if
     zero-downtime is required).
  4. Verify: login works, WS snapshot arrives, a signed webhook settles.
- **Backup & restore drill** -
  1. Backup: `python scripts/db_backup.py` (online-safe sqlite backup API;
     use `pg_dump -Fc` for PostgreSQL deployments). Schedule hourly, ship
     `backups/` off-box.
  2. Restore drill (run monthly): `python scripts/db_restore.py backups/<file>.db /tmp/drill.db`
     - runs `PRAGMA integrity_check` and prints per-table row counts; the
     drill output doubles as the verification record. Restore to production
     only with `--force` after stopping writers.
  3. Success criteria: integrity ok, table counts match the last known-good
     snapshot, and a fresh login + WS connect works against the restored DB.

## Remaining hardening items (post-P1)

1. Full multiplayer server authority (interest management, anti-cheat beyond
   the speed envelope) lands with the multiplayer milestone.
2. Flip `pip-audit` / JS audit to blocking once reports are triaged clean.
3. Container image scanning (trivy) once Dockerfiles ship; compose config
   validation in CI.
4. Rate limiting at the edge (gateway/Caddy) in addition to the app-level
   limits for public deployments.
