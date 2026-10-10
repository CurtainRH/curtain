# Private Data Analysis — experimental toolkit

Private Data Analysis is cloneable, in-process code for running a limited set of aggregate queries against data held by your own service. You provide the dataset connector, authorization, retention rules, and deployment. Curtain does not receive the dataset or operate a compute endpoint.

The first version is a CPU reference implementation supporting count, sum, mean, group-count, and group-sum queries. Query fields are allowlisted by the integrator, rows and groups are bounded, and groups smaller than a configurable minimum cohort are suppressed. Raw rows are consumed in-process and are not included in the result. A GPU/TEE execution adapter is not included in this first slice.

## Clone and test

```sh
git clone https://github.com/CurtainRH/curtain.git
cd curtain/backend
bun install
bun run --filter @curtain/private-analysis test
bun run --filter @curtain/private-analysis typecheck
```

## Integrate

```ts
import { createPrivateAnalysisToolkit } from "@curtain/private-analysis";

const analysis = createPrivateAnalysisToolkit({
  source: yourDatasetConnector,
  policy: {
    dimensions: ["region"],
    measures: ["spend"],
    minimumCohortSize: 5,
    maximumRows: 100_000,
  },
});

const result = await analysis.run({
  requestId: crypto.randomUUID(),
  datasetId: "monthly-spend",
  query: { operation: "group-sum", groupBy: "region", field: "spend" },
});
```

Implement `source.open(datasetId, { signal })` as an async iterable that reads from a store you control. The API deliberately accepts a constrained query instead of arbitrary SQL or user-supplied code. See [`examples/integrator.ts`](examples/integrator.ts) for a runnable in-memory example.

## Privacy boundary

This toolkit helps constrain queries and avoid returning raw rows; it is **not** differential privacy and does not prevent inference from repeated or overlapping queries. The service and source adapter can see the data. If you send rows to a remote GPU/host, that provider can see the data unless your separately designed and verified execution environment prevents it. Encryption in transit, confidential-compute attestation, identity/access control, audit logs, deletion, and query-budget policy are integrator responsibilities. Do not treat a minimum group size alone as a privacy guarantee.

This is experimental reference code, not audited security software. Start with synthetic data, review the source adapter, and threat-model your complete deployment before processing sensitive data.
