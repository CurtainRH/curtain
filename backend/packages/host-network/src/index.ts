import type { BoothsCapabilities } from "@curtain/booths";

export type HostStatus = "verified" | "suspended";

/** Host claims are signed by its chosen identity key; the toolkit does not create host accounts. */
export interface HostClaim {
  hostId: string;
  signer: string;
  region: string;
  /** Endpoint is published/served by the integrator; never contacted by this core toolkit. */
  endpoint?: string;
  capabilities: BoothsCapabilities;
  /** Stable opaque reference to attestation evidence kept by the integrator, not raw evidence. */
  attestationRef: string;
  /** Measurement digest expected by the integrator's verifier policy. */
  measuredImage: `0x${string}`;
  issuedAt: string;
  expiresAt: string;
}

export interface HostRecord extends HostClaim {
  status: HostStatus;
  registeredAt: string;
  verifiedAt: string;
  identitySignature: `0x${string}`;
  attestation: { issuer: string; expiresAt: string; devices: string[] };
  performance?: HostPerformanceEvidence[];
}

export interface HostPerformanceEvidence {
  source: "booths" | "lamps" | "canary";
  reference: string;
  task: string;
  gpuClass: string;
  observedAt: string;
  elapsedMs: number;
  succeeded: boolean;
}

export interface HostIdentityProof {
  signature: `0x${string}`;
}

export interface HostAttestationProof {
  /** Evidence bytes or a verifier-specific object; do not log or persist this value by default. */
  evidence: unknown;
}

export interface HostAttestationResult {
  valid: boolean;
  /** Verifier-confirmed binding between the attested hardware and host signing identity. */
  boundSigner: string;
  measuredImage: `0x${string}`;
  /** Device identities/classes established by the verifier, not copied from the host claim. */
  devices: string[];
  expiresAt: string;
  issuer: string;
}

export interface HostProofVerifier {
  verifyClaim(claim: HostClaim, signature: `0x${string}`): Promise<boolean>;
  verifyAttestation(input: { hostId: string; signer: string; evidence: unknown }): Promise<HostAttestationResult>;
  verifyPerformance(host: HostRecord, evidence: HostPerformanceEvidence, proof: unknown): Promise<boolean>;
}

/** Persistent storage is supplied by the integrating application. */
export interface HostNetworkStore {
  /** Must enforce unique hostId atomically; a prior get() is not a concurrency lock. */
  put(record: HostRecord): Promise<void>;
  get(hostId: string): Promise<HostRecord | undefined>;
  list(): Promise<HostRecord[]>;
  appendPerformance(hostId: string, evidence: HostPerformanceEvidence): Promise<void>;
}

export interface HostNetworkOptions {
  store: HostNetworkStore;
  verifier: HostProofVerifier;
  now?: () => number;
  /** Require enough remaining certificate lifetime at registration; default 1 hour. */
  minAttestationValiditySeconds?: number;
  /** Required to change a host's status; authorization policy remains integrator-owned. */
  authorizeStatusChange?: (input: { hostId: string; status: HostStatus; actorId: string; proof: unknown }) => Promise<boolean>;
}

export class HostNetworkError extends Error {
  constructor(message: string, public readonly code:
    | "INVALID_CLAIM" | "DUPLICATE_HOST" | "INVALID_SIGNATURE" | "INVALID_ATTESTATION"
    | "CAPABILITY_MISMATCH" | "NOT_FOUND" | "NOT_ACTIVE" | "UNAUTHORIZED") {
    super(message);
    this.name = "HostNetworkError";
  }
}

/**
 * In-process host claim verifier and directory logic. It does not provide accounts, contact hosts,
 * poll GPUs, grant trust, custody bonds, or slash funds. Integrators supply proof policy and storage.
 */
export function createHostNetwork(options: HostNetworkOptions) {
  const now = options.now ?? (() => Date.now());
  const minValidity = options.minAttestationValiditySeconds ?? 3600;
  if (!Number.isSafeInteger(minValidity) || minValidity < 0) throw new HostNetworkError("Minimum attestation validity is invalid", "INVALID_CLAIM");

  async function register(input: {
    claim: HostClaim;
    identityProof: HostIdentityProof;
    attestationProof: HostAttestationProof;
  }): Promise<HostRecord> {
    validateClaim(input.claim, now());
    if (await options.store.get(input.claim.hostId)) throw new HostNetworkError("Host ID already exists", "DUPLICATE_HOST");
    if (!(await options.verifier.verifyClaim(input.claim, input.identityProof.signature)))
      throw new HostNetworkError("Host claim signature is invalid", "INVALID_SIGNATURE");
    const attestation = await options.verifier.verifyAttestation({
      hostId: input.claim.hostId, signer: input.claim.signer, evidence: input.attestationProof.evidence,
    });
    if (!attestation || attestation.valid !== true || typeof attestation.boundSigner !== "string" ||
        !/^0x[\da-f]{40}$/i.test(attestation.boundSigner) || !/^0x[\da-f]{64}$/i.test(attestation.measuredImage) ||
        typeof attestation.issuer !== "string" || !attestation.issuer.trim() || !Array.isArray(attestation.devices) ||
        attestation.devices.length === 0 || attestation.devices.some((device) => typeof device !== "string" || !device.trim()) ||
        normalize(attestation.boundSigner) !== normalize(input.claim.signer) ||
        normalize(attestation.measuredImage) !== normalize(input.claim.measuredImage) ||
        parseUtc(attestation.expiresAt) <= now() + minValidity * 1000) {
      throw new HostNetworkError("Attestation is invalid, mismatched, or too close to expiry", "INVALID_ATTESTATION");
    }
    const requiredDevices = multiset(input.claim.capabilities.devices);
    const attestedDevices = multiset(attestation.devices);
    for (const [device, count] of requiredDevices) {
      if ((attestedDevices.get(device) ?? 0) < count)
        throw new HostNetworkError("Advertised Booths devices exceed attested hardware", "CAPABILITY_MISMATCH");
    }
    const record: HostRecord = {
      ...structuredClone(input.claim),
      status: "verified",
      registeredAt: new Date(now()).toISOString(),
      verifiedAt: new Date(now()).toISOString(),
      identitySignature: input.identityProof.signature,
      attestation: { issuer: attestation.issuer, expiresAt: attestation.expiresAt, devices: [...attestation.devices] },
    };
    await options.store.put(record);
    return structuredClone(record);
  }

  async function getActive(hostId: string): Promise<HostRecord> {
    const record = await options.store.get(hostId);
    if (!record) throw new HostNetworkError("Host not found", "NOT_FOUND");
    if (record.status !== "verified" || Date.parse(record.expiresAt) <= now() || Date.parse(record.attestation.expiresAt) <= now())
      throw new HostNetworkError("Host is not currently verified", "NOT_ACTIVE");
    return record;
  }

  async function listActive(): Promise<HostRecord[]> {
    return (await options.store.list()).filter((record) => record.status === "verified" &&
      Date.parse(record.expiresAt) > now() && Date.parse(record.attestation.expiresAt) > now())
      .map((record) => structuredClone(record));
  }

  async function recordPerformance(input: {
    hostId: string;
    evidence: HostPerformanceEvidence;
    proof: unknown;
  }): Promise<HostPerformanceEvidence> {
    const host = await getActive(input.hostId);
    validatePerformance(input.evidence, host, now());
    if (!(await options.verifier.verifyPerformance(host, input.evidence, input.proof)))
      throw new HostNetworkError("Performance evidence could not be authenticated", "INVALID_SIGNATURE");
    await options.store.appendPerformance(host.hostId, structuredClone(input.evidence));
    return structuredClone(input.evidence);
  }

  async function setStatus(input: { hostId: string; status: HostStatus; actorId: string; proof: unknown }): Promise<HostRecord> {
    const host = await options.store.get(input.hostId);
    if (!host) throw new HostNetworkError("Host not found", "NOT_FOUND");
    if (!options.authorizeStatusChange || !(await options.authorizeStatusChange(input)))
      throw new HostNetworkError("Status change was not authorized by integrator policy", "UNAUTHORIZED");
    const updated = { ...host, status: input.status };
    await options.store.put(updated);
    return structuredClone(updated);
  }

  return { register, getActive, listActive, recordPerformance, setStatus };
}

function validateClaim(claim: HostClaim, currentTime: number): void {
  if (!claim || typeof claim.hostId !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(claim.hostId) ||
      typeof claim.signer !== "string" || !/^0x[\da-f]{40}$/i.test(claim.signer) ||
      typeof claim.region !== "string" || !claim.region.trim() || claim.region.length > 80 ||
      (claim.endpoint !== undefined && (typeof claim.endpoint !== "string" || !/^https:\/\//i.test(claim.endpoint) || claim.endpoint.length > 2048)) ||
      typeof claim.attestationRef !== "string" || !claim.attestationRef.trim() || claim.attestationRef.length > 256 ||
      !/^0x[\da-f]{64}$/i.test(claim.measuredImage) ||
      !claim.capabilities || !/^[a-z][a-z0-9_.:-]{0,63}$/i.test(claim.capabilities.provider) ||
      !Array.isArray(claim.capabilities.devices) || claim.capabilities.devices.length === 0 ||
      claim.capabilities.devices.some((device) => typeof device !== "string" || !device.trim() || device.length > 120) ||
      !Array.isArray(claim.capabilities.tasks) || claim.capabilities.tasks.length === 0 ||
      claim.capabilities.tasks.some((task) => typeof task !== "string" || (task !== "*" && !/^[a-z][a-z0-9._-]{0,79}$/.test(task)))) {
    throw new HostNetworkError("Host claim fields are invalid", "INVALID_CLAIM");
  }
  const issued = parseUtc(claim.issuedAt);
  const expires = parseUtc(claim.expiresAt);
  if (issued > currentTime + 5 * 60_000 || expires <= currentTime || expires <= issued)
    throw new HostNetworkError("Host claim timestamps are invalid or expired", "INVALID_CLAIM");
}

function parseUtc(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || new Date(parsed).toISOString() !== value)
    throw new HostNetworkError("Timestamp must be canonical ISO UTC", "INVALID_CLAIM");
  return parsed;
}

function validatePerformance(evidence: HostPerformanceEvidence, host: HostRecord, currentTime: number): void {
  if (!evidence || !["booths", "lamps", "canary"].includes(evidence.source) ||
      !/^[A-Za-z0-9_.:/-]{1,256}$/.test(evidence.reference) ||
      !/^[a-z][a-z0-9._-]{0,79}$/.test(evidence.task) ||
      typeof evidence.gpuClass !== "string" || !host.capabilities.devices.some((device) => device.toLowerCase() === evidence.gpuClass.toLowerCase()) ||
      !Number.isSafeInteger(evidence.elapsedMs) || evidence.elapsedMs < 0 || evidence.elapsedMs > 86_400_000 ||
      typeof evidence.succeeded !== "boolean")
    throw new HostNetworkError("Performance evidence does not match the host claim", "INVALID_CLAIM");
  const observed = parseUtc(evidence.observedAt);
  if (observed > currentTime + 5 * 60_000) throw new HostNetworkError("Evidence timestamp is in the future", "INVALID_CLAIM");
}

function normalize(value: string): string { return value.toLowerCase(); }

function multiset(values: string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const value of values) result.set(value.toLowerCase(), (result.get(value.toLowerCase()) ?? 0) + 1);
  return result;
}
