# Lightning Integration

## Adapter interface (the only boundary)

Gameplay services never touch node code. Everything goes through
`app/payments/interfaces.py`:

```python
class LightningAdapter(ABC):
    async def create_invoice(request: InvoiceRequest) -> Invoice
    async def get_invoice_status(payment_hash: str) -> Invoice
    async def validate_settlement_event(event: SettlementEvent) -> bool
    async def get_node_health() -> dict
    async def reconcile_pending_invoices(payment_hashes: list[str]) -> list[SettlementEvent]
```

Requirements encoded here: typed interface independent of the chosen
implementation; timeouts and typed errors; development and production node
config kept separate; an invoice is a payment request, NOT proof of payment.

## Provider 1 — MockRegtestAdapter (dev/demo, default)

- Generates **structurally valid BOLT11 invoices** (real bech32 encoding,
  `lnbcrt` human-readable part, payment_hash/description/expiry tags). Real
  wallets can parse the QR — payment would only succeed on regtest.
- Simulates the node state machine: `created → awaiting_payment → settled |
  expired`, and refuses double payment or payment after expiry.
- The dev-only `POST /api/v1/dev/lightning/simulate-wallet-payment` endpoint
  (hard-disabled unless `KK_ENV=local` + `KK_DEV_PAYMENT_SIMULATION=true` +
  provider=mock) emulates an external wallet paying an invoice. It emits a
  server-side `SettlementEvent` that flows through the **same idempotent
  pipeline** as a real node webhook — the client is never trusted.
- Satisfies the spec's hackathon payment environment: "Regtest for
  development, followed by a compatible test environment."

## Provider 2 — LdkNodeAdapter (real node path)

`app/payments/ldk_node_adapter.py` implements the same protocol against an
LDK Node sidecar (REST sketch). Before production use, verify per the spec's
binding requirement:

1. **Binding feasibility** — confirm current `ldk-node` Python binding
   support, packaging, and lifecycle behavior (async/threading model: do not
   call bindings from arbitrary threads).
2. **Lifecycle** — start/configure the node OUTSIDE request handlers;
   expose readiness via the health adapter; restore with documented
   recovery procedures and reconcile outstanding invoices on boot.
3. **Secrets** — protect seed material, channel backups, and node
   credentials; never store them in application tables.
4. **Network** — never expose node admin APIs publicly; bind to localhost
   or a private network; authenticate any callback source AND still verify
   settlement independently.

Bring-up on regtest (checklist):

```bash
bitcoind -regtest -fallbackfee=0.0002                       # + mine 101 blocks
ldk-node --network regtest ...                              # open a channel to a peer
KK_LIGHTNING_PROVIDER=ldk_node KK_LDK_NODE_URL=http://127.0.0.1:8080 uvicorn app.main:app
# fund a real wallet (e.g. Phoenix on regtest via neutrirpc) and pay an invoice
```

BOLT12 offers are intentionally deferred until library and wallet support
are validated (spec).

## Reconciliation

A background loop (`payment_maintenance_worker`) periodically:

1. Expires stale `awaiting_payment` intents whose invoice expired.
2. Asks the adapter for authoritative settlement of every unresolved
   invoice; any discovered settlement flows through the same idempotent
   `process_settlement` pipeline (covers missed webhooks and app restarts).

Network timeouts are treated as unknown outcomes until reconciled.

## Node webhook (P1)

When running against a real node, settlement notifications arrive at
`POST /api/v1/payments/webhook`. Transport authentication is mandatory and
the endpoint is disabled until configured:

```bash
KK_WEBHOOK_BEARER=<random-32B>       # Authorization: Bearer <token>
KK_WEBHOOK_SECRET=<random-32B>       # HMAC-SHA256 over "{ts}.{raw_body}"
KK_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS=300
```

Node-side wiring: on `channel.payment_received`, POST

```json
{
  "provider": "ldk_node",
  "provider_event_id": "<unique event id>",
  "payment_hash": "<hash>",
  "amount_paid_sats": 1234,
  "settled_at": 1760000000
}
```

with headers `Authorization: Bearer …`, `X-KK-Timestamp: <unix seconds>` and
`X-KK-Signature: hex(HMAC-SHA256(secret, "{ts}.{body}"))`.

Transport auth is only the front door — the event still passes independent
adapter verification (`validate_settlement_event`) and the exactly-once
fulfillment pipeline, so replays can never double-fulfill. Missed webhooks
are covered by the reconciliation loop below.
