# Lamps — experimental reserved GPU windows

Lamps is a **toolkit**, like Booths: reusable code for a developer to plug into their own service. It is not a Curtain-operated marketplace, hosted API, custodian, payment processor, or dispute service. Integrators bring the database, host/buyer identity system, chain, token, service operations, and business rules.

A Lamp is a specific GPU service window with a stated hardware class, region, capacity, start/end time, supported workloads, and price—not an interchangeable token balance.

## What the toolkit now includes

- Reservation lifecycle, fixed-window capacity controls, and idempotency.
- Postgres persistence adapter and schema, with transactional row locking for competing bookings.
- EIP-712 host usage-receipt verification. This authenticates who signed and what fields they signed; it is not proof of correct compute or advertised hardware.
- Pluggable escrow interface and reference ERC-20 escrow contract at `backend/contracts/src/lamps/LampsWindowEscrow.sol`.
- Buyer-confirmed release, release after a configured review window, and a no-show refund when the host never starts.
- Configurable buyer dispute stake and host bond, with mutual buyer/host signed settlement and no unilateral operator authority.

The integrator chooses the payment asset, chain, identity mapping, stake basis points, review period, and deployment. The example stake values in the package README are illustrative only.

## Mutual-only disputes: important limitation

If either party refuses to sign or disappears, disputed funds remain locked indefinitely. The escrow intentionally has no admin rescue key or single-party resolver. Integrators must disclose this consequence and decide whether mutual-only resolution is appropriate before deploying the reference contract. A dispute timeout or arbitration fallback would be a separate business/policy choice, not something this toolkit silently invents.

## Clone and test

```sh
git clone https://github.com/CurtainRH/curtain.git
cd curtain/backend
bun install
bun run --filter @curtain/lamps test
bun run --filter @curtain/lamps typecheck
```

See the [Lamps package guide](../backend/packages/lamps/README.md) for wiring the storage, receipt identity resolver, and escrow adapter. The reference contract is unaudited and undeployed; do not use it with real funds without independent review and integration tests. Cross-database/chain actions are not atomic, so adapters need idempotency and reconciliation.

Booths remains a cloneable in-process compute runtime at `backend/packages/booths`; integrators bring their own GPU/provider and invoke it from their own service. See [`BOOTHS_RUNTIME.md`](BOOTHS_RUNTIME.md).
