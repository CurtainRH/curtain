# Host Network — experimental verification toolkit

Host Network is cloneable code for integrators building their own compute-host directories and policies. It is not a Curtain-hosted registry, onboarding service, attestation authority, monitoring service, or staking/slashing operator.

## First slice

- Verify a signed host claim through an identity verifier supplied by the integrator.
- Verify hardware/image evidence through the integrator's attestation verifier and trust roots.
- Reject claims that advertise more GPU devices than the attestation verifier establishes.
- Store only a claim and attestation summary through an integrator-provided store; raw evidence is passed to the verifier and is not persisted by this toolkit.
- Record Booths, Lamps, or canary performance evidence only after a supplied verifier authenticates its source.
- Filter out suspended or expired claims when listing active hosts.

The attestation adapter must establish the binding between host signing identity, GPU/device classes, and measured image. Host-provided strings or a valid signature alone do not establish real hardware. Performance records are evidence inputs, not an automatic trust score or guarantee of future availability.

## Integrate

```ts
import { createHostNetwork } from "@curtain/host-network";

const hosts = createHostNetwork({
  store: yourHostStore,
  verifier: {
    verifyClaim: yourIdentityVerifier,
    verifyAttestation: yourGpuAttestationVerifier,
    verifyPerformance: yourBoothsLampsEvidenceVerifier,
  },
});

const record = await hosts.register({ claim, identityProof, attestationProof });
const currentlyEligible = await hosts.listActive();
```

Your store must enforce unique host IDs atomically and persist performance evidence. The toolkit does not contact the published endpoint. The integrator owns discovery, endpoint checks, re-attestation schedule, certificate roots, and host suspension.

## Build and test

From the cloned repository's `backend/` directory:

```sh
bun install
bun run --filter @curtain/host-network test
bun run --filter @curtain/host-network typecheck
```

## Not included yet

This first slice has no Postgres adapter, active canary scheduler/challenge protocol, common benchmark suite, GPU-bond contract, custody, or slashing. Bonding and enforcement need explicit integrator-supplied policy and adapters; this package never decides or executes a slash. CI fixtures validate interfaces and claim checks, not production GPU attestation or real host reliability.
