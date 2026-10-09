# Host Network — experimental toolkit

Host Network is cloneable toolkit code for developers building their own compute-host directory. It is not a Curtain-run registry or attestation service. Integrators bring host identity, storage, GPU/TEE attestation roots and verification, monitoring, and any bond or enforcement policy.

The first package at `backend/packages/host-network` verifies signed host claims using an injected identity verifier, checks GPU classes and measured-image claims through an injected attestation verifier, and records authenticated Booths/Lamps/canary performance evidence through an injected source verifier. It filters expired or suspended hosts. It does not contact host endpoints or retain raw attestation evidence.

**Trust boundary:** a signed host claim proves who signed the claim, not that the hardware is real. A trusted attestation adapter must validate evidence against an integrator-selected trust root and bind the GPU/device identity and measured image to the host. Performance evidence is historical input, not a guarantee of future service.

This first slice does not include a canary scheduler/challenge protocol, a Postgres adapter, bond custody, a staking contract, or slashing. Those are separate integrations requiring explicit policy; the toolkit does not choose or execute penalties. See the [package guide](../backend/packages/host-network/README.md).

Clone and test from `backend/`:

```sh
bun install
bun run --filter @curtain/host-network test
bun run --filter @curtain/host-network typecheck
```
