# Passes — experimental

`@curtain/passes` is cloneable, in-process policy code for fixed-denomination prepaid units. It provides blind-issuance and token-verification adapter interfaces, restricts pass uses to gas, AI, agent payments, or relays, atomically consumes nullifiers to prevent double spends, and calls an integrator-owned adapter for redemption back to a shielded balance.

It is not a blind-signature implementation, issuer, custodian, gas sponsor, relay, payment processor, or shielded-balance system. Integrators supply cryptography, issuer keys, balance accounting, nullifier storage, chains, recipient services, and failure reconciliation. Store implementations must atomically enforce nullifier uniqueness and request idempotency; the balance adapter must make redemption requests idempotent so a retry after a store failure cannot credit twice.

Run `bun run --filter @curtain/passes test` and `bun run --filter @curtain/passes typecheck` from `backend`.
