# Host Network — experimental verification toolkit

Host Network is cloneable code for integrators building their own compute-host directories and policies. It is not a Curtain-hosted registry, onboarding service, attestation authority, monitoring service, or staking/slashing operator.

## First slice

- Verify a signed host claim through an identity verifier supplied by the integrator.
- Verify hardware/image evidence through the integrator's attestation verifier and trust roots.
- Reject claims that advertise more GPU devices than the attestation verifier establishes.
- Store only a claim and attestation summary through an integrator-provided store; raw evidence is passed to the verifier and is not persisted by this toolkit.
- Record Booths, Lamps, or canary performance evidence only after a supplied verifier authenticates its source.
- Issue fresh nonce-bound canary challenges and run them through an integrator-supplied executor/verifier. Authenticated failures are recorded; timeouts and unverifiable responses are `indeterminate`, not failures.
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
    verifyCanary: yourChallengeAndAttestationVerifier,
  },
  canaryExecutor: yourSyntheticWorkloadRunner,
});

const record = await hosts.register({ claim, identityProof, attestationProof });
const currentlyEligible = await hosts.listActive();
const challengeResult = await hosts.runCanary({ hostId, gpuClass: "NVIDIA H100", task: "inference" });
```

The executor should run only a synthetic workload derived from the fresh nonce—never user prompts or private datasets. Its verifier must bind the response to the challenge, host identity, attested device, measured image, expected result, and a defensible runtime measurement. This core does not know whether a claimed timing was measured by a trusted observer. The integrator schedules checks and chooses failure thresholds/retries.

Your store must enforce unique host IDs atomically and persist performance and challenge records. The toolkit does not contact the published endpoint itself. The integrator owns discovery, endpoint checks, re-attestation schedule, certificate roots, and authorization to suspend hosts.

## Build and test

From the cloned repository's `backend/` directory:

```sh
bun install
bun run --filter @curtain/host-network test
bun run --filter @curtain/host-network typecheck
```

## Not included yet

The toolkit has no active canary scheduler or common benchmark suite. Lamps' reference escrow already holds a configurable per-booking host bond and sends that bond to the buyer on the objective on-chain no-start refund. Host Network does not introduce a second, network-wide stake or slash based on canary results. Any standing host bond, subjective penalty, or canary-based slashing requires separate integrator policy and authorization. CI fixtures validate interfaces with mocks; they do not prove production GPU attestation or reliability.
