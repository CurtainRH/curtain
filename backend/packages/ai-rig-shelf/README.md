# AI Rig shelf and basket — experimental

`@curtain/ai-rig-shelf` is cloneable, in-process planning code for AI-infrastructure asset shelves and baskets. It validates asset metadata supplied by an integrator, defines baskets with target and maximum exposure weights, calculates deterministic rebalance plans from a price snapshot, and calculates pro-rata in-kind redemption outputs.

This package is **not** an issuer, custodian, broker, marketplace, price oracle, token listing, or redemption service. It does not verify that an address is canonical, an issuer is legitimate, a price is executable, holdings exist, or an asset has any backing or liquidity. Integrators must independently verify asset addresses, issuer terms, custody, venues, prices, liquidity, eligibility, and redemption mechanics before executing any returned plan.

## Use

```ts
import { createAiRigShelf } from "@curtain/ai-rig-shelf";

const shelf = createAiRigShelf({ assets: yourVerifiedAssetMetadata });
shelf.defineBasket(yourBasket);

const assessment = shelf.assess("ai-rig-1", yourHoldings, yourPriceSnapshot);
const rebalance = shelf.planRebalance("rebalance-request-123", "ai-rig-1", yourHoldings, yourPriceSnapshot);
const redemption = shelf.planInKindRedemption("redeem-request-123", "ai-rig-1", yourHoldings, "1000000", "250000");
```

Persist request IDs idempotently around every real settlement. The toolkit does not maintain inventory or execute transfers, so database, chain, venue, and custody failures must be reconciled by the integrating application. A plan only describes arithmetic from caller-provided inputs; it is not execution authorization or a guarantee of delivery.

Run `bun run --filter @curtain/ai-rig-shelf test` and `bun run --filter @curtain/ai-rig-shelf typecheck` from `backend`.
