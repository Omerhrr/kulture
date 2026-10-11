# Demo Runbook — Bitcoin Build-Athon 2026

**Total time: ~6 minutes.** Rehearse this twice before the event. The
complete demo works from a clean environment (acceptance KK-010).

## Pre-flight (T-30 min)

```bash
# verify all services
curl -s http://localhost:3000/api/v1/health/live
curl -s http://localhost:3000/api/v1/health/ready   # database ok + lightning healthy
node scripts/ws-smoke.mjs                            # WS + agent E2E (should print Musa dialogue)
```

- Have the demo account ready: `demo_player / kaduna-demo-2026`.
- Keep a **fallback demo video** recorded (see below).
- Do NOT create the demo account on stage — log in, don't register.

## Script

### 1. The pitch (30 s)

> "Kaduna Kulture is a living Kaduna in your browser — and its economy runs
> on real Bitcoin Lightning. Not a crypto balance bolted onto a game: the
> server verifies every payment against a Lightning node and delivers items
> exactly once. The shopkeeper is an AI agent with an audit trail. Watch."

### 2. Enter the world (60 s)

- Open the app → **Enter the world** → log in as `demo_player`.
- Point out the HUD: **₦25,000 is simulated NGN — game money, NOT Bitcoin**
  (acceptance KK-012). The green dot means the authoritative WebSocket is live.

### 3. Walk + talk to the AI shopkeeper (90 s)

- Walk (WASD) up Ali Akilu Road to **Musa's Provision Store**, press **E**.
- **Talk to Mallam Musa** — the dialogue box shows the 🤖 **DSH agent** badge.
  He answers in character, referencing live stock and Lightning prices.
- Mention: every tool call he makes is validated (allowlist + schema +
  economic bounds) and persisted — show `agent_runs` / `agent_actions`
  rows if the audience is technical.

### 4. The delivery job (90 s)

- Interact again → **Ask about delivery work** → accept
  **"Deliver Suya Spice to Stonetech Square"**.
- Walk to the store → **📦 Pick up** (server validates you're actually there).
- Walk to **Stonetech Square** → **✅ Deliver** → NGN + reputation paid
  through the ledger. Open **📜 Ledger** — simulated NGN entries are clearly
  labeled; real sats never mix with them.

### 5. The Lightning purchase (2 min — the money shot)

- Back at Musa's → **🛒 Browse** → pick **Suya Spice (⚡ 1,500 sats)** → Buy.
- The backend validates stock/price, creates the intent, and the adapter
  issues a **structurally valid `lnbcrt` BOLT11 invoice** — scan it with a
  real wallet to show it parses.
- Click **Simulate external wallet payment (dev)** — explain this button
  stands in for Phoenix/Zeus paying on regtest; it emits the same settlement
  event a node webhook would.
- The dialog flips to **settled** and the item lands in **🎒 Inventory**.
- Say the magic words: *"The client never told the server the payment
  happened — the backend verified settlement against the node and fulfilled
  exactly once. Replay the same settlement event and nothing duplicates."*

### 6. If time remains (30 s)

- **NEPA Wahala**: if the outage banner fires, that's the world simulation —
  Musa's store closes, purchases are rejected, power comes back automatically.
- Open `/api/docs` — the whole contract is OpenAPI-documented.

## Fallback plan

1. **LLM down** → the shopkeeper automatically switches to the deterministic
   fallback (badge shows ⚙️). The demo narrative is unaffected — say "this is
   the bounded fallback path working as designed".
2. **Live payment demo fails** → play the pre-recorded fallback video
   (record: full purchase flow, 90 s, screen + narration).
3. **World won't boot** → `docker compose up` is the documented clean path;
   `pytest -q` green is the sanity proof.

## Post-demo Q&A ammo

- Custody? *We hold nothing; users pay invoices from their own wallets.
  Withdrawals/deposits are out of scope pending legal review.*
- Can the AI spend sats? *No such tool exists — prohibited capabilities are
  unregistered, not just blocked.*
- Real money? *This build runs the full state machine against a regtest-style
  simulator; swapping `KK_LIGHTNING_PROVIDER=ldk_node` points it at a real
  node on regtest.*
- Multiplayer? *The authoritative WS + resync foundation is in; presence and
  interest management are the next phase.*
