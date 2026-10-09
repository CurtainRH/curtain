# Rig Rate — experimental

Rig Rate is a cloneable, in-process calculator for a public hourly compute reference rate by GPU class, region, time window, and payment asset. It accepts normalized observations from paid Booths sessions, completed Lamps reservations, and public boards; calculates a deterministic median price per GPU-hour; retains provenance; excludes configured outliers; and returns explicit `ok`, `thin_market`, or `insufficient_data` results with confidence reasons.

It is not an oracle, marketplace, price feed, attestation service, or payment verifier. Integrators authenticate every source themselves and only set `settled: true` after independently confirming settlement. Source adapters and persistence are optional interfaces owned by the integrator. Public-board observations remain lower confidence; estimates with small, single-source, aging, or expired data must not be represented as executable liquidity or a reliable market price.

## Use

```ts
import { createRigRate } from "@curtain/rig-rate";

const index = createRigRate();
index.record({
  id: "booths-session-123",
  source: "booths",
  sourceReference: "session-123",
  gpuClass: "NVIDIA H100",
  priceAsset: "USDG",
  priceAmount: "12500000",
  durationSeconds: 3600,
  gpuCount: 1,
  observedAt: new Date().toISOString(),
  settled: true,
});

const rate = index.quote("NVIDIA H100", "USDG");
// `pricePerGpuHour` is expressed in the smallest USDG unit.
```

Run `bun run --filter @curtain/rig-rate test` and `bun run --filter @curtain/rig-rate typecheck` from `backend`.
