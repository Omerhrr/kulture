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

- Money in integer minor units (sats / kobo) — never floats.
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

## Known hardening items (P1, post-hackathon)

1. Server-authoritative movement reconciliation (REST interactions currently
   trust client-supplied positions within world bounds — the WS stream is
   rate-limited and bounded, but full authority lands with multiplayer).
2. CSRF strategy if cookie sessions replace bearer tokens.
3. Dependency & container scanning, secret rotation, backup restore drills.
4. Real-node webhook authentication (bearer + payload hash) in addition to
   independent verification.
