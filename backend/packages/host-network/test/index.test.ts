import { describe, expect, test } from "bun:test";
import {
  createHostNetwork, HostNetworkError, type HostClaim, type HostNetworkStore,
  type HostPerformanceEvidence, type HostRecord,
} from "../src";

const issuedAt = "2030-01-01T00:00:00.000Z";
const expiresAt = "2030-01-03T00:00:00.000Z";
const signer = "0x1111111111111111111111111111111111111111";
const measurement = `0x${"ab".repeat(32)}` as `0x${string}`;
const claim: HostClaim = {
  hostId: "host-a", signer, region: "eu-west", endpoint: "https://host.example.test",
  capabilities: { provider: "test-gpu", devices: ["NVIDIA H100", "NVIDIA H100"], tasks: ["inference"] },
  attestationRef: "attestation:fixture-1", measuredImage: measurement, issuedAt, expiresAt,
};

function createStore(): HostNetworkStore {
  const hosts = new Map<string, HostRecord>();
  const challenges = new Map<string, import("../src").HostCanaryChallenge>();
  return {
    async put(record) { hosts.set(record.hostId, structuredClone(record)); },
    async get(hostId) { const record = hosts.get(hostId); return record && structuredClone(record); },
    async list() { return [...hosts.values()].map((record) => structuredClone(record)); },
    async appendPerformance(hostId, evidence) {
      const record = hosts.get(hostId);
      if (!record) throw new Error("host missing");
      record.performance ??= [];
      record.performance.push(structuredClone(evidence));
    },
    async putCanaryChallenge(challenge) { challenges.set(challenge.id, structuredClone(challenge)); },
    async completeCanaryChallenge(challenge) { challenges.set(challenge.id, structuredClone(challenge)); },
  };
}

function verifier(overrides: Record<string, unknown> = {}) {
  return {
    verifyClaim: async () => true,
    verifyAttestation: async () => ({
      valid: true, boundSigner: signer, measuredImage: measurement,
      devices: ["NVIDIA H100", "NVIDIA H100"], expiresAt, issuer: "test-root",
    }),
    verifyPerformance: async () => true,
    verifyCanary: async () => ({ authenticated: true, passed: true }),
    ...overrides,
  } as const;
}

function executor(overrides: Record<string, unknown> = {}) {
  return {
    execute: async ({ host, challenge }: { host: HostRecord; challenge: import("../src").HostCanaryChallenge }) => ({
      result: { challengeId: challenge.id, hostId: host.hostId, gpuClass: challenge.gpuClass,
        measuredImage: host.measuredImage, outputHash: measurement, elapsedMs: 500 },
      proof: "signed-synthetic-result",
    }),
    ...overrides,
  } as const;
}

describe("cloneable host verification toolkit", () => {
  test("registers only claims bound to valid attestation and Booths device capacity", async () => {
    let now = Date.parse("2030-01-01T01:00:00.000Z");
    const networkStore = createStore();
    const network = createHostNetwork({ store: networkStore, verifier: verifier(), canaryExecutor: executor(), now: () => now });
    const host = await network.register({ claim, identityProof: { signature: "0x1234" }, attestationProof: { evidence: "opaque" } });
    expect(host.status).toBe("verified");
    expect(host.attestation.issuer).toBe("test-root");
    expect((await network.listActive()).map((item) => item.hostId)).toEqual(["host-a"]);
    await expect(network.setStatus({ hostId: "host-a", status: "suspended", actorId: "admin", proof: null }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const adminNetwork = createHostNetwork({ store: networkStore, verifier: verifier(), canaryExecutor: executor(),
      authorizeStatusChange: async ({ actorId }) => actorId === "admin", now: () => now });
    await adminNetwork.setStatus({ hostId: "host-a", status: "suspended", actorId: "admin", proof: "signed-admin-action" });
    await expect(adminNetwork.getActive("host-a")).rejects.toMatchObject({ code: "NOT_ACTIVE" });
    now = Date.parse(expiresAt);
    await expect(adminNetwork.getActive("host-a")).rejects.toMatchObject({ code: "NOT_ACTIVE" });
  });

  test("rejects excess advertised devices, invalid identity signatures and expired attestations", async () => {
    const store = createStore();
    const tooFewDevices = createHostNetwork({ store, verifier: verifier({
      verifyAttestation: async () => ({ valid: true, boundSigner: signer, measuredImage: measurement,
        devices: ["NVIDIA H100"], expiresAt, issuer: "test-root" }),
    }), canaryExecutor: executor(), now: () => Date.parse("2030-01-01T01:00:00.000Z") });
    await expect(tooFewDevices.register({ claim, identityProof: { signature: "0x1234" }, attestationProof: { evidence: null } }))
      .rejects.toMatchObject({ code: "CAPABILITY_MISMATCH" });

    const badIdentity = createHostNetwork({ store, verifier: verifier({ verifyClaim: async () => false }), canaryExecutor: executor(),
      now: () => Date.parse("2030-01-01T01:00:00.000Z") });
    await expect(badIdentity.register({ claim, identityProof: { signature: "0x1234" }, attestationProof: { evidence: null } }))
      .rejects.toMatchObject({ code: "INVALID_SIGNATURE" });

    const expired = createHostNetwork({ store, verifier: verifier({
      verifyAttestation: async () => ({ valid: true, boundSigner: signer, measuredImage: measurement,
        devices: ["NVIDIA H100", "NVIDIA H100"], expiresAt: "2030-01-01T01:30:00.000Z", issuer: "test-root" }),
    }), canaryExecutor: executor(), now: () => Date.parse("2030-01-01T01:00:00.000Z"), minAttestationValiditySeconds: 3600 });
    await expect(expired.register({ claim, identityProof: { signature: "0x1234" }, attestationProof: { evidence: null } }))
      .rejects.toMatchObject({ code: "INVALID_ATTESTATION" });
  });

  test("records only authenticated performance evidence for claimed GPU classes", async () => {
    const store = createStore();
    const network = createHostNetwork({ store, verifier: verifier(), canaryExecutor: executor(), now: () => Date.parse("2030-01-01T01:00:00.000Z") });
    await network.register({ claim, identityProof: { signature: "0x1234" }, attestationProof: { evidence: null } });
    const evidence: HostPerformanceEvidence = {
      source: "lamps", reference: "booking-1", task: "inference", gpuClass: "NVIDIA H100",
      observedAt: "2030-01-01T00:30:00.000Z", elapsedMs: 1200, succeeded: true,
    };
    await network.recordPerformance({ hostId: "host-a", evidence, proof: "verified-booking-receipt" });
    expect((await network.getActive("host-a")).performance).toEqual([evidence]);
    await expect(network.recordPerformance({ hostId: "host-a", evidence: { ...evidence, gpuClass: "A100" }, proof: null }))
      .rejects.toMatchObject({ code: "INVALID_CLAIM" });
    const unauthenticated = createHostNetwork({ store, verifier: verifier({ verifyPerformance: async () => false }), canaryExecutor: executor(),
      now: () => Date.parse("2030-01-01T01:00:00.000Z") });
    await expect(unauthenticated.recordPerformance({ hostId: "host-a", evidence, proof: null }))
      .rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
  });

  test("issues fresh GPU-bound canaries and distinguishes authenticated failure from inconclusive timeout", async () => {
    const store = createStore();
    let now = Date.parse("2030-01-01T01:00:00.000Z");
    const network = createHostNetwork({ store, verifier: verifier(), canaryExecutor: executor(),
      now: () => now, canaryChallengeTtlSeconds: 60, canaryTimeoutMs: 500 });
    await network.register({ claim, identityProof: { signature: "0x1234" }, attestationProof: { evidence: null } });
    const passed = await network.runCanary({ hostId: "host-a", gpuClass: "NVIDIA H100", task: "inference" });
    expect(passed.status).toBe("passed");
    expect(passed.nonce).toMatch(/^0x[\da-f]{64}$/i);
    expect((await network.getActive("host-a")).performance?.at(-1)?.succeeded).toBe(true);

    const failed = createHostNetwork({ store, verifier: verifier({
      verifyCanary: async () => ({ authenticated: true, passed: false }),
    }), canaryExecutor: executor(), now: () => now });
    const rejected = await failed.runCanary({ hostId: "host-a", gpuClass: "NVIDIA H100", task: "inference" });
    expect(rejected.status).toBe("failed");
    expect((await failed.getActive("host-a")).performance?.at(-1)?.succeeded).toBe(false);
    const recordedCount = (await failed.getActive("host-a")).performance?.length;

    let wasAborted = false;
    const timedOut = createHostNetwork({ store, verifier: verifier(), canaryExecutor: executor({
      execute: async ({ signal }: { signal: AbortSignal }) => new Promise((_, reject) => {
        signal.addEventListener("abort", () => { wasAborted = true; reject(new Error("aborted")); }, { once: true });
      }),
    }), now: () => now, canaryTimeoutMs: 100 });
    const inconclusive = await timedOut.runCanary({ hostId: "host-a", gpuClass: "NVIDIA H100", task: "inference" });
    expect(inconclusive.status).toBe("indeterminate");
    expect(wasAborted).toBe(true);
    expect((await timedOut.getActive("host-a")).performance?.length).toBe(recordedCount);

    const mismatched = createHostNetwork({ store, verifier: verifier(), canaryExecutor: executor({
      execute: async ({ host, challenge }: { host: HostRecord; challenge: import("../src").HostCanaryChallenge }) => ({
        result: { challengeId: "0xwrong", hostId: host.hostId, gpuClass: challenge.gpuClass,
          measuredImage: host.measuredImage, outputHash: measurement, elapsedMs: 500 },
        proof: "signed-synthetic-result",
      }),
    }), now: () => now });
    const mismatchedResult = await mismatched.runCanary({ hostId: "host-a", gpuClass: "NVIDIA H100", task: "inference" });
    expect(mismatchedResult.status).toBe("indeterminate");
    expect((await mismatched.getActive("host-a")).performance?.length).toBe(recordedCount);
  });
});
