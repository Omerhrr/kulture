# Payment State Machine

## Intent states

```
created ──▶ awaiting_payment ──▶ settled
   │              │     ▲
   │              ├──-> expired
   ├──▶ failed    ├──▶ cancelled      (player action, pre-settlement only)
   └─▶ expired    └─▶ reconciliation_required
                       (paid but unfulfillable — e.g. stock gone; refund is a
                        separately designed, human-authorized process)
```

Invoice states mirror the node: `created | awaiting_payment | settled |
expired | failed`.

## The 10-step purchase flow (implementation map)

| Step | Spec name | Where |
|------|-----------|-------|
| 1 | Initiate purchase | ShopPanel → `POST /api/v1/purchases` |
| 2 | Validate purchase | `shop_service.create_purchase` — identity, listing, price (server-owned), stock, business status, quantity bounds |
| 3 | Persist intent | `payment_intents` row + mandatory idempotency key (UNIQUE — replay returns the original intent untouched) |
| 4 | Create invoice | `lightning_service.create_invoice_for_intent` → adapter; exact authorized amount; pre-computed payment hash binds intent↔invoice |
| 5 | Display invoice | BOLT11 string + expiry to the authenticated client; QR rendered client-side |
| 6 | Await settlement | node events or `get_invoice_status` polling |
| 7 | Verify and persist | `process_settlement`: adapter verification + amount match (intent & invoice) + unique `provider_event_id` |
| 8 | Fulfill purchase | ONE transaction: status-transition guard (`status != 'settled'`) + atomic stock decrement (`quantity_available >= qty`) + inventory grant + `sats_ref` ledger entry |
| 9 | Notify player | `payment.status` + `inventory.updated` via WebSocket (authoritative) |
| 10 | Reconcile | periodic comparison of unresolved records vs node state |

## Guarantees (and where the tests prove them)

| Guarantee | Mechanism | Test |
|-----------|-----------|------|
| No fulfillment before verified settlement | settlement requires `adapter.validate_settlement_event` | `test_client_cannot_confirm_payment` |
| Repeated events never double-deliver | unique `provider_event_id` + status-transition guard | `test_settlement_fulfills_exactly_once` |
| Replayed purchases are safe | idempotency key returns the original intent | `test_purchase_replay_safe` |
| Last item never oversells | atomic stock decrement; loser → `reconciliation_required` | `test_concurrent_purchases_of_last_item_never_oversell` |
| Expired invoices can't be paid | adapter refuses + expiry worker | `test_expired_invoice_cannot_settle` |
| Missed webhook is recovered | reconciliation loop | `test_reconciliation_recovers_missed_settlement` |
| Restart doesn't lose pending payments | intents/invoices/events are durable rows; workers re-drive from DB | (outbox pattern + reconciliation tests) |
| Amounts are exact | invoice created for the server-computed amount; mismatch rejected | amount checks in `process_settlement` |

## Refunds & disputes

Not implemented by design. Settled Lightning payments are never
auto-refunded; `reconciliation_required` flags the case for a separately
designed, human-authorized support process before real-money volume is
accepted.
