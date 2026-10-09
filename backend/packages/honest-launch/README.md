# Honest Launch — experimental

`@curtain/honest-launch` is cloneable, in-process policy code for screened token-launch allocation flows. It enforces total and launch-window aggregate caps through an integrator-provided atomic store, calls integrator-owned deployer and funding-source screening adapters, and produces signed aggregate-only launch certificates.

It is not a token issuer, screening provider, launch contract, custody system, certificate registry, or guarantee that a launch is safe. Integrators supply token contracts, chain deployment, screening data/policy, atomic storage, signing keys, certificate publication, legal terms, and operational recovery.

The certificate contains public launch policy and aggregate allocation totals only; it never includes participant references. Store implementations must atomically deduplicate request IDs and reserve both caps across concurrent allocations.

Run `bun run --filter @curtain/honest-launch test` and `bun run --filter @curtain/honest-launch typecheck` from `backend`.
