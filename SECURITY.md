# Security Policy

## Reporting a vulnerability

Email the maintainers or open a private security advisory. Do NOT open a
public issue for payment or custody vulnerabilities.

Scope of particular interest:

- Payment state machine (fulfillment before verified settlement, duplicate
  events, replay, amount mismatch)
- Lightning adapter boundary and node credential handling
- Agent tool authorization (anything that could move real sats)
- Authentication and authorization on player resources

## Non-goals (current MVP)

The MVP accepts Lightning invoices for in-game items via a regtest-style
simulator and holds no user funds. Withdrawals, custody, and cash-out are out
of scope — see docs/security.md for the financial compliance boundary.

## Hardening commitments before real-money volume

- Security review of payment operations
- Secrets management + rotation
- Dependency and container scanning
- Backup/restore drills
- Legal and regulatory assessment (Nigeria virtual-asset / payment services)
