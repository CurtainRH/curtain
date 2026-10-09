# Host Network — experimental toolkit

Host Network is cloneable toolkit code for developers building their own compute-host directory. It is not a Curtain-run registry or attestation service. Integrators bring host identity, storage, GPU/TEE attestation roots and verification, monitoring, and any bond or enforcement policy.

The first package at `backend/packages/host-network` verifies signed host claims using an injected identity verifier, checks GPU classes and measured-image claims through an injected attestation verifier, records authenticated Booths/Lamps evidence, and issues fresh nonce-bound canary challenges through integrator-supplied execution and verification adapters. A timeout or unverifiable response is indeterminate, not a failure. It filters expired or suspended hosts. It does not contact host endpoints or retain raw attestation evidence.

**Trust boundary:** a signed host claim proves who signed the claim, not that the hardware is real. A trusted attestation adapter must validate evidence against an integrator-selected trust root and bind the GPU/device identity and measured image to the host. Performance evidence is historical input, not a guarantee of future service.

The toolkit does not schedule checks or provide a canonical GPU benchmark; the integrator chooses the synthetic challenge, cadence, retries, and verification roots. Lamps' reference escrow already holds a configurable per-booking host bond and sends it to the buyer on an objective on-chain no-start refund. Host Network adds no separate standing stake and never slashes based on canary results. Any extra custody or canary-based penalty requires separate policy and an authorized verifier. See the [package guide](../backend/packages/host-network/README.md).

Clone and test from `backend/`:

```sh
bun install
bun run --filter @curtain/host-network test
bun run --filter @curtain/host-network typecheck
```
