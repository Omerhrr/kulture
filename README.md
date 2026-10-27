<div align="center">

# 🛺 Kaduna Kulture

**A Living Kaduna. An Economy Powered by Bitcoin.**

A 3D browser-based life simulator with a Bitcoin Lightning-native economy.

</div>

---

## What is this?

Kaduna Kulture is a playable, persistent Kaduna city simulation. Players walk
the full city map - River Kaduna, Murtala Square, the Central Market, Ahmadu
Bello Stadium, Barnawa, Kakuri, Kawo, Rigasa, the airport and more (layout
derived from OpenStreetMap data, stylized) - take delivery jobs from an
**AI shopkeeper** (DSH-powered, with a full audit trail), and buy goods with
**real Bitcoin sats over Lightning** - where the backend independently verifies
settlement before delivering items exactly once. On phones the game runs with
a touch joystick in landscape.

This is a Bitcoin-native economy, not a conventional game with a crypto
balance bolted on: an invoice is a payment *request*, never proof of payment;
the authoritative server owns every sat, stock count, job, and price.

## What's new in v3 - a bigger, modern, real-size Kaduna

- Everything at one real-world scale: characters, cars, houses and streets
  are life-size and the city map is stretched 3x (~6.3 x 7.4 km).
- A full residential street grid with ~32,000 modern compounds (duplexes,
  flats, shop rows, compound walls + gates, water tanks, solar), drawn with
  GPU instancing and level of detail.
- A CBD skyline of ~50 towers (30-125 m) whose windows light up at night.
- Realistic people: proper proportions, jointed limbs, kaftan/kufi and
  gown/hijab outfits, and a close third-person camera.
- Image-based lighting, soft shadows, real lane markings, 8 m LED street
  lights, wider river and bridges.

See [docs/gameplay.md](docs/gameplay.md#world-scale--the-modern-city-v3).

### v3.1 - a living, physical city

- **Weather + wind**: sunny, cloudy, rain, thunderstorms and harmattan dust,
  changing on their own (press **Y** or tap the weather chip to switch).
  Rain streaks, drifting clouds, lightning + thunder, trees and crops sway
  in the wind, rain and wind sounds.
- **Solid world**: compound walls, towers, kiosks, poles and tree trunks all
  block you; vehicles crash (camera shake, bounce, crunch).
- **Impacts**: step in front of a moving car and you are knocked down,
  tumble, lie on the road and get back up; drive into people and they fall.
- **Real-looking vehicles**: saloon cars, yellow danfo buses with roof racks,
  keke NAPEP, Bajaj-style okadas, bicycles and lorries.
- **Boarding**: walk to the door, it opens, you climb in and sit at the
  wheel (or astride a bike); getting out is animated too.
- **Public places**: ~17 hospitals, ~30 schools, ~19 filling stations and
  ~70 mechanic workshops, shown on the map.
- **Street life**: container kiosks with plastic chairs, generators, bus
  shelters, billboards, water-vendor carts; people carry shopping bags,
  briefcases, backpacks and basins on their heads, talk on phones, and open
  umbrellas when it rains.
- **Every house can be entered**: walk to any compound gate and press E for
  a furnished interior (each home decorated differently).

## Accounts

Anyone can play: open the site, choose **Create free account**, pick a
username (3-32 letters, numbers or `_`, not case-sensitive) and a password
(8+ characters). Every new player starts with 2,500,000 k-sats.
There is no shared demo login; the old `demo_player` account is locked
automatically on servers that still have it.

## The golden path (what to demo)

1. **Create free account** - pick a username and password, and you are in.
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
└── docker-compose.yml   # postgres + backend + frontend + caddy (production)
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

## Docker / production (https://kulture.rogan.live)

```bash
cp infra/env.production.example .env   # fill in secrets (or let scripts/vps/setup.sh do it)
docker compose up -d --build
# Caddy serves KK_DOMAIN over HTTPS - API on /api, WS on /ws, Postgres inside
```

Full VPS guide (DNS, one-command setup, updates, backups): [docs/deploy.md](docs/deploy.md).

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
