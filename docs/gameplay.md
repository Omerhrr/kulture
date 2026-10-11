# Gameplay

## World - Kaduna City

The full city map at roughly 1 unit = 10 m: River Kaduna crossing the city,
the road grid (Ahmadu Bello Way, Yakubu Gowon Way, Ali Akilu Road, Nnamdi
Azikiwe Way, Kachia Road and more), real districts (Kawo, Malali, Badiko,
Rigasa, Barnawa, Kakuri, Sabon Tasha, Narayi, Television and others) and
landmarks at their mapped positions: Murtala Square, Kaduna Central Market,
Ahmadu Bello Stadium, Sultan Bello Mosque, St. Joseph's Cathedral, Government
House, Kaduna Junction, Rigasa Station, Kaduna Airport, NDA, the refinery,
textile mill and Millennium City. The layout is derived from OpenStreetMap
data (c) OpenStreetMap contributors, ODbL - stylized game geometry, not
survey data. Bridges: Coronation Bridge, Yar'adua Way Bridge, Nnamdi Azikiwe
Bridge.

| Landmark | Purpose |
|----------|---------|
| Musa's Provision Store | DSH shopkeeper, goods, delivery-job issuer |
| Arewa QuickPOS Kiosk | Lightning point-of-service reference + asset-class explainer |
| Kaduna Central Market | Stalls, market events |
| Arewa House | Recognizable city center landmark (Sir Ahmadu Bello's residence) |
| Stonetech Square | Community plaza, delivery drop-off (Hajiya Amina) |
| Keke Napep Stop | Transport prototype (at Kaduna Junction) |

## Player capabilities (MVP)

Walk and navigate (WASD/arrows, local prediction + server persistence),
interact with nearby entities (server-validated distance), accept and
complete jobs, purchase goods via Lightning, view inventory / job history /
auditable ledger.

## Economy - three asset classes, never mixed

| Asset | Source of truth | Usage |
|-------|-----------------|-------|
| ⚡ Bitcoin sats (real) | verified Lightning payment records | explicitly authorized purchases |
| 💰 Simulated NGN | server-side game ledger | job rewards, market prices, flavor |
| ⭐ Reputation | server-side progression records | unlocking, trust |

Rules enforced in code and UI: never silently convert NGN to sats; never
advertise fictional balances as redeemable Bitcoin; integer satoshi amounts
only; payment amounts and recipients displayed clearly; no wagering or cash
redemption in the MVP; AI agents cannot create money.

## Jobs - Market Delivery (vertical slice)

1. **Accept** - job must be `available`; becomes `assigned` to the player.
2. **Pick up** - player must be within the pickup entity's radius (server
   checks); grants the sealed `quest_parcel` item.
3. **Complete** - player must be within the drop-off radius AND hold the
   parcel; consumes it, credits NGN + reputation through the ledger.

Rewards: ₦8,000 sim + 5 reputation (seeded job). The DSH shopkeeper can post
additional bounded delivery jobs (≤ 6 open, ≤ ₦50,000 each).

## World events (simulated state only - never authorize transfers)

- **NEPA Wahala** (power outage): Musa's store flips to `power_outage`
  (purchases 409) for ~100 s, then the restore worker reopens it.
- **Market Rush**: demand hype banner across the world feed.

Events broadcast as `world.event` over WebSockets and are visible to all
players.

## Movement & interaction validation

- Client sends rate-limited `player.move` (≤ 20 Hz, client-throttled ~9 Hz);
  the server clamps world bounds and persists every ~2 s.
- Interactions (REST and WS) are validated server-side against the entity's
  interaction radius.
- Known hardening item (P1): the REST interaction endpoint trusts the
  client-supplied position within the world bounds; full server-authoritative
  movement reconciliation lands with multiplayer (roadmap).
