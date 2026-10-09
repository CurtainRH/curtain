# Rig Rate — experimental

Rig Rate is a cloneable, in-process calculator for a public hourly compute reference rate by GPU class and payment asset. It accepts normalized observations from paid Booths sessions, completed Lamps reservations, and public boards, calculates a median price per GPU-hour, and exposes source and market-quality flags.

It is not an oracle, marketplace, price feed, attestation service, or payment verifier. Integrators authenticate every source themselves and only set `settled: true` after independently confirming settlement. Public-board observations remain flagged `low-quality`; small, single-source, aging, or expired data must not be represented as a reliable market price.

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
