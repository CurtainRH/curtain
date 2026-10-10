# Private Data Analysis — experimental toolkit

Private Data Analysis is reusable code to clone into your own service for policy-bounded analysis of datasets your service controls. It is not a Curtain-hosted compute service. You bring the data connector, access control, compute environment, retention policy, and deployment.

The first slice is a CPU reference implementation accepting a small declarative query set—count, sum, mean, group-count, and group-sum—rather than arbitrary SQL or user code. Integrators allowlist dimensions and measures, cap the rows/groups processed, and choose a minimum cohort size; small groups are omitted from grouped results. Source rows are consumed in-process and are not included in the result. GPU/TEE execution adapters are not part of this first slice.

## Clone and test

```sh
git clone https://github.com/CurtainRH/curtain.git
cd curtain/backend
bun install
bun run --filter @curtain/private-analysis test
bun run --filter @curtain/private-analysis typecheck
```

The package guide and sample integrator are in [`backend/packages/private-analysis`](../backend/packages/private-analysis/README.md).

## Important boundary

This toolkit does not provide differential privacy, encryption, a trusted execution environment, or protection against inference from repeated/overlapping queries. The integrator's process and data source can see the data; an external compute host may also see it unless the integrator separately deploys and verifies protections such as confidential computing. Treat this as experimental code and use synthetic data until your full deployment has been reviewed.
