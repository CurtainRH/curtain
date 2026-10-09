# Lamps — experimental reserved-window toolkit

Lamps is reusable code for building fixed GPU service-window bookings around Booths. A Lamp names a particular host, GPU class, region, capacity, UTC start/end window, workload, and price. This package is a toolkit, not a Curtain-hosted marketplace or payment service. Integrators bring their own service, database, identity records, chain, token, and operating policies.

## What this package provides

- Reservation lifecycle with host/buyer roles, request idempotency, fixed-window capacity checks, and Booths job linkage.
- A Postgres store adapter with a transaction-locked capacity reservation. Apply [`sql/schema.sql`](sql/schema.sql) to the integrator's database, then use `postgresLampsStore` from `@curtain/lamps/postgres`.
- EIP-712 host receipt verification from `@curtain/lamps/receipts`. The integrator maps `hostId` to an authorized signing address.
- Escrow and signature-verification ports for a payment adapter chosen by the integrator.
- A reference ERC-20 escrow contract at `backend/contracts/src/lamps/LampsWindowEscrow.sol`. It accepts the token, bond basis points, review window, and no-show grace at deployment; it has no owner or unilateral dispute resolver.

Receipt signatures authenticate the submitting host and bind the receipt fields to a booking. They do **not** prove the host used the advertised hardware, that the result is correct, or that the workload completed honestly. Integrators need their own verification/acceptance policy.

## Try it

```sh
git clone https://github.com/CurtainRH/curtain.git
cd curtain/backend
bun install
bun run --filter @curtain/lamps test
bun run --filter @curtain/lamps typecheck
```

The `createLampsToolkit` constructor requires a `LampsStore`, `LampsReceiptVerifier`, `LampsEscrow`, and explicit stake basis points. No token, chain, database URL, hosted endpoint, or default staking amount is imposed. Call `fund` as the buyer, `postHostBond` as the host, then accept/start/deliver. The escrow implementation must make operations idempotent or expose state checks so callers can safely recover after an RPC or database failure.

```ts
import { createLampsToolkit } from "@curtain/lamps";
import { postgresLampsStore } from "@curtain/lamps/postgres";
import { eip712ReceiptVerifier } from "@curtain/lamps/receipts";

const lamps = createLampsToolkit({
  store: postgresLampsStore(yourDb),
  receipts: eip712ReceiptVerifier({
    chainId: yourChainId,
    verifyingContract: yourEscrowAddress,
    hostAddress: (hostId) => yourIdentityStore.addressFor(hostId),
  }),
  escrow: yourEscrowAdapter,
  stakePolicy: { hostBondBps: 2_000, buyerDisputeStakeBps: 500 }, // example only
  reviewWindowSeconds: 24 * 60 * 60,
});
```

Apply the schema from this package before constructing the Postgres adapter. The store serializes competing reservations by locking the offer row, but the external database and chain cannot share a single atomic transaction; integrators must reconcile chain events and retry idempotently.

## Escrow and dispute rules

The reference contract escrows buyer payment and a host bond, supports buyer-confirmed release, permissionless release after the review window, and an objective no-show refund if the host never starts. A buyer dispute requires a configured stake. Disputed funds are released only when **both buyer and host sign the same EIP-712 settlement**; neither Curtain nor a single operator can decide the outcome.

Mutual-only resolution has an important consequence: if either side disappears or refuses to sign, disputed funds remain locked indefinitely. There is no hidden admin recovery path. Integrators should disclose this plainly and decide whether that trade-off fits their use case before deploying. The contract is reference code, not audited or deployed by this package change; review and test it before handling real funds.

The stake percentages and payment token are deployment/configuration choices. Example basis points above are illustrations, not a recommended economic policy. Host and buyer bonds use the same token as the booking payment in the reference contract.
