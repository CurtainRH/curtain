export interface LaunchPolicy {
  tokenId: string;
  launchStart: string;
  launchEnd: string;
  totalSupplyCap: string;
  /** Tighter aggregate allocation cap applicable only during the launch window. */
  launchWindowCap: string;
}
export interface LaunchAllocationRequest {
  requestId: string;
  tokenId: string;
  /** Opaque participant reference; this toolkit does not publish participant allocation data. */
  participantReference: string;
  amount: string;
  deployerReference: string;
  fundingReferences: string[];
}
export interface LaunchAllocation extends LaunchAllocationRequest { allocatedAt: string; status: "allocated"; }
export interface LaunchAggregate { tokenId: string; allocatedAmount: string; allocations: number; launchWindowAllocatedAmount: string; }
export interface LaunchCertificate { tokenId: string; launchStart: string; launchEnd: string; totalSupplyCap: string; launchWindowCap: string; aggregate: LaunchAggregate; issuedAt: string; }
export interface SignedLaunchCertificate { certificate: LaunchCertificate; signature: string; }

/** Screening claims authenticate the source decision only; the integrator defines its data/policy. */
export interface LaunchScreeningAdapter {
  screenDeployer(reference: string): Promise<{ approved: boolean; reference: string }>;
  screenFunding(reference: string): Promise<{ approved: boolean; reference: string }>;
}
export interface LaunchCertificateSigner { sign(certificate: LaunchCertificate): Promise<string>; }
/** Must atomically deduplicate request IDs and enforce both cap inputs across concurrent reservations. */
export interface HonestLaunchStore {
  getByRequest(requestId: string): Promise<LaunchAllocation | undefined>;
  reserve(input: { allocation: LaunchAllocation; totalSupplyCap: string; launchWindowCap?: string }): Promise<LaunchAllocation>;
  aggregate(tokenId: string): Promise<LaunchAggregate>;
}
export interface HonestLaunchOptions { policy: LaunchPolicy; screening: LaunchScreeningAdapter; store: HonestLaunchStore; signer: LaunchCertificateSigner; now?: () => number; }
export class HonestLaunchError extends Error {
  constructor(message: string, public readonly code: "INVALID_POLICY" | "INVALID_REQUEST" | "SCREENING_DENIED" | "CAP_EXCEEDED" | "INVALID_CERTIFICATE") { super(message); this.name = "HonestLaunchError"; }
}

/** In-process launch policy. It is not a token issuer, screening provider, chain contract, custody system, or launch guarantee. */
export function createHonestLaunch(options: HonestLaunchOptions) {
  const now = options.now ?? (() => Date.now()); validatePolicy(options.policy, now());
  async function allocate(request: LaunchAllocationRequest): Promise<LaunchAllocation> {
    validateRequest(request, options.policy.tokenId);
    const prior = await options.store.getByRequest(request.requestId); if (prior) return structuredClone(prior);
    const deployer = await options.screening.screenDeployer(request.deployerReference);
    if (!deployer?.approved || deployer.reference !== request.deployerReference) throw new HonestLaunchError("Deployer screening was not approved", "SCREENING_DENIED");
    for (const fundingReference of request.fundingReferences) { const result = await options.screening.screenFunding(fundingReference); if (!result?.approved || result.reference !== fundingReference) throw new HonestLaunchError("Funding-source screening was not approved", "SCREENING_DENIED"); }
    const timestamp = now(); const inLaunchWindow = timestamp >= Date.parse(options.policy.launchStart) && timestamp < Date.parse(options.policy.launchEnd);
    const allocation: LaunchAllocation = { ...structuredClone(request), allocatedAt: new Date(timestamp).toISOString(), status: "allocated" };
    return structuredClone(await options.store.reserve({ allocation, totalSupplyCap: options.policy.totalSupplyCap, ...(inLaunchWindow ? { launchWindowCap: options.policy.launchWindowCap } : {}) }));
  }
  async function aggregate(): Promise<LaunchAggregate> { return structuredClone(await options.store.aggregate(options.policy.tokenId)); }
  async function issueCertificate(): Promise<SignedLaunchCertificate> {
    const current = await aggregate();
    if (current.tokenId !== options.policy.tokenId || !uint(current.allocatedAmount) || !uint(current.launchWindowAllocatedAmount) || !Number.isSafeInteger(current.allocations) || current.allocations < 0) throw new HonestLaunchError("Store returned an invalid aggregate", "INVALID_CERTIFICATE");
    const certificate: LaunchCertificate = { tokenId: options.policy.tokenId, launchStart: options.policy.launchStart, launchEnd: options.policy.launchEnd, totalSupplyCap: options.policy.totalSupplyCap, launchWindowCap: options.policy.launchWindowCap, aggregate: current, issuedAt: new Date(now()).toISOString() };
    const signature = await options.signer.sign(structuredClone(certificate));
    if (typeof signature !== "string" || signature.length < 1 || signature.length > 4096) throw new HonestLaunchError("Certificate signer returned an invalid signature", "INVALID_CERTIFICATE");
    return { certificate, signature };
  }
  return { allocate, aggregate, issueCertificate };
}
function validatePolicy(policy: LaunchPolicy, current: number): void {
  if (!policy || !id(policy.tokenId) || !uint(policy.totalSupplyCap) || !uint(policy.launchWindowCap) || BigInt(policy.launchWindowCap) > BigInt(policy.totalSupplyCap)) throw new HonestLaunchError("Launch policy is invalid", "INVALID_POLICY");
  const start = utc(policy.launchStart); const end = utc(policy.launchEnd); if (end <= start || end <= current - 366 * 24 * 60 * 60_000) throw new HonestLaunchError("Launch window is invalid", "INVALID_POLICY");
}
function validateRequest(request: LaunchAllocationRequest, tokenId: string): void {
  if (!request || !id(request.requestId) || request.tokenId !== tokenId || !reference(request.participantReference) || !uint(request.amount) || !reference(request.deployerReference) || !Array.isArray(request.fundingReferences) || request.fundingReferences.length > 32 || request.fundingReferences.some((value) => !reference(value))) throw new HonestLaunchError("Launch allocation request is invalid", "INVALID_REQUEST");
}
function id(value: string): boolean { return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value); }
function reference(value: string): boolean { return typeof value === "string" && /^[A-Za-z0-9_.:/-]{1,256}$/.test(value); }
function uint(value: string): boolean { return typeof value === "string" && /^[1-9]\d{0,77}$/.test(value) && BigInt(value) < 2n ** 256n; }
function utc(value: string): number { const parsed = Date.parse(value); if (!Number.isFinite(parsed) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || new Date(parsed).toISOString() !== value) throw new HonestLaunchError("Timestamp must be canonical ISO UTC", "INVALID_POLICY"); return parsed; }
