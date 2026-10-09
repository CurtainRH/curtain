export type UnderstudyStatus = "active" | "revoked" | "expired";

export interface UnderstudyRule {
  venueId: string;
  action: string;
  assetId: string;
  /** Maximum amount for a single approved action, in the asset's smallest unit. */
  maxAmount: string;
}

export interface UnderstudyPolicy {
  accountId: string;
  /** Opaque controller reference. Never provide raw shielded/private key material to this toolkit. */
  controllerReference: string;
  /** Opaque recovery reference used by the integrator's deterministic key/account derivation. */
  recoveryReference: string;
  purpose: string;
  expiresAt: string;
  /** Maximum aggregate gas funding in the integrator-selected smallest gas-token unit. */
  gasBudget: string;
  rules: UnderstudyRule[];
}

export interface UnderstudyAccount extends UnderstudyPolicy {
  /** Smart-account address/identifier provisioned by the integrator, not derived or deployed here. */
  publicAccountReference: string;
  status: UnderstudyStatus;
  createdAt: string;
}

export interface UnderstudyAction {
  requestId: string;
  accountId: string;
  venueId: string;
  action: string;
  assetId: string;
  amount: string;
  gasAmount: string;
}

export interface AuthorizedUnderstudyAction extends UnderstudyAction {
  authorizedAt: string;
  /** This is an authorization record, never a signed/broadcast transaction. */
  status: "authorized";
}

export interface GasFundingRequest {
  requestId: string;
  accountId: string;
  gasAmount: string;
}

/** Integrators verify user-controlled signatures against their own shielded-key/account design. */
export interface UnderstudyAuthorizer {
  verifyCreate(policy: UnderstudyPolicy, proof: unknown): Promise<boolean>;
  verifyRecovery(account: UnderstudyAccount, recoveryReference: string, proof: unknown): Promise<boolean>;
}

/** Integrators provision the actual account, choose its chain, and return its public reference. */
export interface UnderstudyProvisioner {
  provision(policy: UnderstudyPolicy): Promise<{ publicAccountReference: string }>;
  prepareGasFunding?(input: { account: UnderstudyAccount; request: GasFundingRequest }): Promise<unknown>;
}

/** Store operations must be atomic: unique account IDs and request IDs, plus usage reservation. */
export interface UnderstudyStore {
  getAccount(accountId: string): Promise<UnderstudyAccount | undefined>;
  createAccount(account: UnderstudyAccount): Promise<void>;
  putAccount(account: UnderstudyAccount): Promise<void>;
  /** Must atomically return a prior request or reserve its gas/asset amounts against the supplied limits. */
  reserveAction(input: { action: AuthorizedUnderstudyAction; maxAmount: string; gasBudget: string }): Promise<AuthorizedUnderstudyAction>;
}

export interface UnderstudyOptions {
  store: UnderstudyStore;
  authorizer: UnderstudyAuthorizer;
  provisioner: UnderstudyProvisioner;
  now?: () => number;
}

export class UnderstudyError extends Error {
  constructor(message: string, public readonly code: "INVALID_POLICY" | "INVALID_ACTION" | "DUPLICATE_ACCOUNT" | "INVALID_AUTHORIZATION" | "NOT_FOUND" | "NOT_ACTIVE" | "POLICY_DENIED" | "RECOVERY_DENIED" | "GAS_UNAVAILABLE") {
    super(message);
    this.name = "UnderstudyError";
  }
}

/**
 * In-process account-policy logic. It neither derives shielded keys nor deploys/signs/broadcasts
 * transactions. The integrating application owns key derivation, account deployment, gas balance,
 * storage atomicity, recovery UX, and all chain/venue interactions.
 */
export function createUnderstudyToolkit(options: UnderstudyOptions) {
  const now = options.now ?? (() => Date.now());

  async function create(policy: UnderstudyPolicy, proof: unknown): Promise<UnderstudyAccount> {
    validatePolicy(policy, now());
    if (await options.store.getAccount(policy.accountId)) throw new UnderstudyError("Account ID already exists", "DUPLICATE_ACCOUNT");
    if (!(await options.authorizer.verifyCreate(structuredClone(policy), proof))) throw new UnderstudyError("Owner authorization was rejected", "INVALID_AUTHORIZATION");
    const provisioned = await options.provisioner.provision(structuredClone(policy));
    if (!provisioned || !/^[A-Za-z0-9_.:/-]{1,256}$/.test(provisioned.publicAccountReference)) throw new UnderstudyError("Provisioner returned an invalid account reference", "INVALID_POLICY");
    const account: UnderstudyAccount = { ...structuredClone(policy), publicAccountReference: provisioned.publicAccountReference, status: "active", createdAt: new Date(now()).toISOString() };
    await options.store.createAccount(account);
    return structuredClone(account);
  }

  async function getActive(accountId: string): Promise<UnderstudyAccount> {
    const account = await options.store.getAccount(accountId);
    if (!account) throw new UnderstudyError("Understudy account not found", "NOT_FOUND");
    if (account.status !== "active" || Date.parse(account.expiresAt) <= now()) throw new UnderstudyError("Understudy account is not active", "NOT_ACTIVE");
    return structuredClone(account);
  }

  async function authorize(action: UnderstudyAction): Promise<AuthorizedUnderstudyAction> {
    validateAction(action);
    const account = await getActive(action.accountId);
    const rule = account.rules.find((candidate) => candidate.venueId === action.venueId && candidate.action === action.action && candidate.assetId === action.assetId);
    if (!rule || BigInt(action.amount) > BigInt(rule.maxAmount)) throw new UnderstudyError("Action is outside the account's approved policy", "POLICY_DENIED");
    if (BigInt(action.gasAmount) > BigInt(account.gasBudget)) throw new UnderstudyError("Action gas exceeds the account's gas budget", "POLICY_DENIED");
    const authorized: AuthorizedUnderstudyAction = { ...structuredClone(action), authorizedAt: new Date(now()).toISOString(), status: "authorized" };
    return structuredClone(await options.store.reserveAction({ action: authorized, maxAmount: rule.maxAmount, gasBudget: account.gasBudget }));
  }

  async function prepareGasFunding(request: GasFundingRequest): Promise<unknown> {
    if (!request || !safeId(request.requestId) || !safeId(request.accountId) || !uint(request.gasAmount)) throw new UnderstudyError("Gas funding request is invalid", "INVALID_ACTION");
    const account = await getActive(request.accountId);
    if (BigInt(request.gasAmount) > BigInt(account.gasBudget)) throw new UnderstudyError("Gas funding request exceeds account budget", "POLICY_DENIED");
    if (!options.provisioner.prepareGasFunding) throw new UnderstudyError("No gas funding adapter is configured", "GAS_UNAVAILABLE");
    return options.provisioner.prepareGasFunding({ account, request: structuredClone(request) });
  }

  async function recover(accountId: string, recoveryReference: string, proof: unknown): Promise<UnderstudyAccount> {
    const account = await options.store.getAccount(accountId);
    if (!account) throw new UnderstudyError("Understudy account not found", "NOT_FOUND");
    if (recoveryReference !== account.recoveryReference || !(await options.authorizer.verifyRecovery(account, recoveryReference, proof)))
      throw new UnderstudyError("Recovery authorization was rejected", "RECOVERY_DENIED");
    return structuredClone(account);
  }

  async function revoke(accountId: string): Promise<UnderstudyAccount> {
    const account = await options.store.getAccount(accountId);
    if (!account) throw new UnderstudyError("Understudy account not found", "NOT_FOUND");
    const updated = { ...account, status: "revoked" as const };
    await options.store.putAccount(updated);
    return structuredClone(updated);
  }

  return { create, getActive, authorize, prepareGasFunding, recover, revoke };
}

function validatePolicy(policy: UnderstudyPolicy, current: number): void {
  if (!policy || !safeId(policy.accountId) || !safeReference(policy.controllerReference) || !safeReference(policy.recoveryReference) ||
      !policy.purpose.trim() || policy.purpose.length > 256 || !uint(policy.gasBudget) || !Array.isArray(policy.rules) || policy.rules.length === 0 || policy.rules.length > 64)
    throw new UnderstudyError("Understudy policy is invalid", "INVALID_POLICY");
  const expires = parseUtc(policy.expiresAt);
  if (expires <= current || expires > current + 366 * 24 * 60 * 60_000) throw new UnderstudyError("Understudy expiry is invalid", "INVALID_POLICY");
  const rules = new Set<string>();
  for (const rule of policy.rules) {
    if (!rule || !safeId(rule.venueId) || !/^[a-z][a-z0-9._-]{0,79}$/.test(rule.action) || !safeId(rule.assetId) || !uint(rule.maxAmount))
      throw new UnderstudyError("Understudy rule is invalid", "INVALID_POLICY");
    const key = `${rule.venueId}:${rule.action}:${rule.assetId}`;
    if (rules.has(key)) throw new UnderstudyError("Understudy rules must be unique", "INVALID_POLICY");
    rules.add(key);
  }
}

function validateAction(action: UnderstudyAction): void {
  if (!action || !safeId(action.requestId) || !safeId(action.accountId) || !safeId(action.venueId) ||
      !/^[a-z][a-z0-9._-]{0,79}$/.test(action.action) || !safeId(action.assetId) || !uint(action.amount) || !/^(0|[1-9]\d{0,77})$/.test(action.gasAmount))
    throw new UnderstudyError("Understudy action is invalid", "INVALID_ACTION");
}

function safeId(value: string): boolean { return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value); }
function safeReference(value: string): boolean { return typeof value === "string" && /^[A-Za-z0-9_.:/-]{1,256}$/.test(value); }
function uint(value: string): boolean { return typeof value === "string" && /^[1-9]\d{0,77}$/.test(value) && BigInt(value) < 2n ** 256n; }
function parseUtc(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || new Date(parsed).toISOString() !== value)
    throw new UnderstudyError("Expiry must be canonical ISO UTC", "INVALID_POLICY");
  return parsed;
}
