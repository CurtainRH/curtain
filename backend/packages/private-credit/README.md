# Private credit and outside positions — experimental

`@curtain/private-credit` is a cloneable, in-process policy toolkit for connecting a private account flow to selected external credit or position venues. It validates venue disclosures, obtains an integrator-supplied collateral price through a replaceable adapter, enforces collateral and loan-to-value limits, records idempotent position requests, and keeps venue liquidation visibility explicit.

It is not a credit venue, lender, custodian, oracle, broker, privacy guarantee, or liquidation service. The external venue can still see positions and liquidations it operates. Integrators supply the venue adapter, price source, canonical collateral assets, custody/settlement model, issuer and backing verification, legal terms, identity policy, monitoring, and recovery procedures.

## Use

```ts
import { createPrivateCreditToolkit } from "@curtain/private-credit";

const credit = createPrivateCreditToolkit({
  policy: yourRiskPolicy,
  venues: yourVerifiedVenueDisclosures,
  prices: yourPriceAdapter,
  adapter: yourOutsidePositionAdapter,
  store: yourIdempotentStore,
});

const position = await credit.open(yourCreditRequest);
```

Persist request IDs atomically, reconcile venue/chain events after any timeout or failure, and record external liquidations with `recordLiquidation`. A source label or a signed venue response authenticates its source only; it does not prove collateral backing, executable liquidity, price accuracy, or fair liquidation behavior.

Run `bun run --filter @curtain/private-credit test` and `bun run --filter @curtain/private-credit typecheck` from `backend`.
