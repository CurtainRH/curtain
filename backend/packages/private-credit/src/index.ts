export type PositionStatus = "open" | "closed" | "liquidated";

/** The integrator independently verifies these venue disclosures before configuring the toolkit. */
export interface CreditVenueDisclosure {
  venueId: string;
  name: string;
  termsUrl: string;
  backingDisclosureUrl: string;
  observedBorrowRateBps: number;
  observedAt: string;
  /** A venue sees its own position ownership and liquidation activity. This cannot be set false. */
  venueSeesPositionAndLiquidation: true;
}

export interface CollateralPolicy {
  assetId: string;
  decimals: number;
  /** Price is denominated in the toolkit's priceAsset per whole collateral token. */
  maxLoanToValueBps: number;
  maxCollateralAmount: string;
}

export interface PrivateCreditPolicy {
  priceAsset: string;
  maxBorrowAmount: string;
  collateral: CollateralPolicy[];
  maxPriceAgeSeconds?: number;
}

export interface CollateralPrice {
  assetId: string;
  priceAsset: string;
  /** Smallest priceAsset unit per one whole collateral token. */
  priceAmount: string;
  observedAt: string;
  sourceReference: string;
}

export interface CreditPositionRequest {
  requestId: string;
  venueId: string;
  /** Opaque venue/account reference. The toolkit does not derive or link wallet addresses. */
  accountReference: string;
  collateralAssetId: string;
  collateralAmount: string;
  borrowAmount: string;
}

export interface OutsidePosition {
  id: string;
  requestId: string;
  venueId: string;
  accountReference: string;
  collateralAssetId: string;
  collateralAmount: string;
  borrowAmount: string;
  collateralValue: string;
  maxPermittedBorrow: string;
  status: PositionStatus;
  openedAt: string;
  closedAt?: string;
  liquidatedAt?: string;
  /** Explicitly retains the venue-visibility boundary. */
  venueSeesPositionAndLiquidation: true;
}

/** The integrating application supplies chain, venue, custody, and signing behavior. */
export interface OutsidePositionAdapter {
  open(input: CreditPositionRequest): Promise<{ externalPositionId: string }>;
  close(input: { externalPositionId: string; requestId: string }): Promise<void>;
}

/** Persistence must atomically enforce requestId uniqueness and reconcile venue events after failures. */
export interface PrivateCreditStore {
  getByRequest(requestId: string): Promise<OutsidePosition | undefined>;
  get(id: string): Promise<OutsidePosition | undefined>;
  put(position: OutsidePosition): Promise<void>;
}

export interface PrivateCreditOptions {
  policy: PrivateCreditPolicy;
  venues: CreditVenueDisclosure[];
  prices: { get(assetId: string, priceAsset: string): Promise<CollateralPrice> };
  adapter: OutsidePositionAdapter;
  store: PrivateCreditStore;
  now?: () => number;
}

export class PrivateCreditError extends Error {
  constructor(message: string, public readonly code: "INVALID_POLICY" | "INVALID_REQUEST" | "INVALID_DISCLOSURE" | "STALE_PRICE" | "COLLATERAL_LIMIT" | "BORROW_LIMIT" | "NOT_FOUND" | "INVALID_STATE") {
    super(message);
    this.name = "PrivateCreditError";
  }
}

/**
 * In-process policy and reconciliation layer. It is not a credit venue, custodian, oracle,
 * privacy system, or liquidation service. A signed venue response authenticates that venue only;
 * callers independently verify asset backing, rates, collateral, settlement, and venue terms.
 */
export function createPrivateCreditToolkit(options: PrivateCreditOptions) {
  const now = options.now ?? (() => Date.now());
  const maxPriceAgeSeconds = options.policy.maxPriceAgeSeconds ?? 15 * 60;
  validatePolicy(options.policy, maxPriceAgeSeconds);
  const collateral = new Map(options.policy.collateral.map((entry) => [entry.assetId, structuredClone(entry)]));
  const venues = new Map<string, CreditVenueDisclosure>();
  for (const venue of options.venues) {
    validateVenue(venue, now());
    if (venues.has(venue.venueId)) throw new PrivateCreditError("Venue IDs must be unique", "INVALID_DISCLOSURE");
    venues.set(venue.venueId, structuredClone(venue));
  }

  async function quote(request: CreditPositionRequest): Promise<{ collateralValue: string; maxPermittedBorrow: string; price: CollateralPrice }> {
    validateRequest(request);
    if (!venues.has(request.venueId)) throw new PrivateCreditError("Venue is not configured", "INVALID_DISCLOSURE");
    const rule = collateral.get(request.collateralAssetId);
    if (!rule) throw new PrivateCreditError("Collateral asset is not configured", "COLLATERAL_LIMIT");
    if (BigInt(request.collateralAmount) > BigInt(rule.maxCollateralAmount)) throw new PrivateCreditError("Collateral amount exceeds policy limit", "COLLATERAL_LIMIT");
    const price = await options.prices.get(request.collateralAssetId, options.policy.priceAsset);
    validatePrice(price, request.collateralAssetId, options.policy.priceAsset, now(), maxPriceAgeSeconds);
    const collateralValue = (BigInt(request.collateralAmount) * BigInt(price.priceAmount)) / 10n ** BigInt(rule.decimals);
    const ltvLimit = (collateralValue * BigInt(rule.maxLoanToValueBps)) / 10_000n;
    const maxPermittedBorrow = ltvLimit < BigInt(options.policy.maxBorrowAmount) ? ltvLimit : BigInt(options.policy.maxBorrowAmount);
    if (BigInt(request.borrowAmount) > maxPermittedBorrow) throw new PrivateCreditError("Borrow amount exceeds collateral or policy limit", "BORROW_LIMIT");
    return { collateralValue: collateralValue.toString(), maxPermittedBorrow: maxPermittedBorrow.toString(), price: structuredClone(price) };
  }

  async function open(request: CreditPositionRequest): Promise<OutsidePosition> {
    const prior = await options.store.getByRequest(request.requestId);
    if (prior) return structuredClone(prior);
    const evaluated = await quote(request);
    const opened = await options.adapter.open(structuredClone(request));
    if (!opened || !/^[A-Za-z0-9_.:-]{1,160}$/.test(opened.externalPositionId)) throw new PrivateCreditError("Venue returned an invalid position ID", "INVALID_STATE");
    const position: OutsidePosition = {
      id: opened.externalPositionId, requestId: request.requestId, venueId: request.venueId,
      accountReference: request.accountReference, collateralAssetId: request.collateralAssetId,
      collateralAmount: request.collateralAmount, borrowAmount: request.borrowAmount,
      collateralValue: evaluated.collateralValue, maxPermittedBorrow: evaluated.maxPermittedBorrow,
      status: "open", openedAt: new Date(now()).toISOString(), venueSeesPositionAndLiquidation: true,
    };
    await options.store.put(position);
    return structuredClone(position);
  }

  async function close(input: { positionId: string; requestId: string }): Promise<OutsidePosition> {
    validateId(input.positionId, "positionId"); validateId(input.requestId, "requestId");
    const position = await options.store.get(input.positionId);
    if (!position) throw new PrivateCreditError("Position not found", "NOT_FOUND");
    if (position.status === "closed") return structuredClone(position);
    if (position.status === "liquidated") throw new PrivateCreditError("A liquidated position cannot be closed", "INVALID_STATE");
    await options.adapter.close({ externalPositionId: position.id, requestId: input.requestId });
    const updated = { ...position, status: "closed" as const, closedAt: new Date(now()).toISOString() };
    await options.store.put(updated);
    return structuredClone(updated);
  }

  async function recordLiquidation(positionId: string, observedAt: string): Promise<OutsidePosition> {
    validateId(positionId, "positionId");
    const timestamp = parseUtc(observedAt, "observedAt");
    if (timestamp > now() + 5 * 60_000) throw new PrivateCreditError("Liquidation timestamp is in the future", "INVALID_STATE");
    const position = await options.store.get(positionId);
    if (!position) throw new PrivateCreditError("Position not found", "NOT_FOUND");
    if (position.status === "liquidated") return structuredClone(position);
    if (position.status === "closed") throw new PrivateCreditError("A closed position cannot be liquidated", "INVALID_STATE");
    const updated = { ...position, status: "liquidated" as const, liquidatedAt: observedAt };
    await options.store.put(updated);
    return structuredClone(updated);
  }

  function getVenueDisclosure(venueId: string): CreditVenueDisclosure | undefined {
    const venue = venues.get(venueId);
    return venue ? structuredClone(venue) : undefined;
  }

  return { quote, open, close, recordLiquidation, getVenueDisclosure };
}

function validatePolicy(policy: PrivateCreditPolicy, maxPriceAgeSeconds: number): void {
  if (!policy || !/^[A-Za-z0-9_.:-]{1,96}$/.test(policy.priceAsset) || !uint(policy.maxBorrowAmount) ||
      !Array.isArray(policy.collateral) || policy.collateral.length === 0 || policy.collateral.length > 32 ||
      !Number.isSafeInteger(maxPriceAgeSeconds) || maxPriceAgeSeconds < 60) throw new PrivateCreditError("Private credit policy is invalid", "INVALID_POLICY");
  const seen = new Set<string>();
  for (const asset of policy.collateral) {
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(asset.assetId) || seen.has(asset.assetId) || !Number.isSafeInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 36 ||
        !Number.isSafeInteger(asset.maxLoanToValueBps) || asset.maxLoanToValueBps < 1 || asset.maxLoanToValueBps > 10_000 || !uint(asset.maxCollateralAmount))
      throw new PrivateCreditError("Collateral policy is invalid", "INVALID_POLICY");
    seen.add(asset.assetId);
  }
}

function validateVenue(venue: CreditVenueDisclosure, current: number): void {
  if (!venue || !/^[A-Za-z0-9_.:-]{1,128}$/.test(venue.venueId) || !venue.name.trim() || venue.name.length > 160 ||
      !https(venue.termsUrl) || !https(venue.backingDisclosureUrl) || !Number.isSafeInteger(venue.observedBorrowRateBps) || venue.observedBorrowRateBps < 0 || venue.observedBorrowRateBps > 1_000_000 ||
      venue.venueSeesPositionAndLiquidation !== true) throw new PrivateCreditError("Venue disclosure is invalid", "INVALID_DISCLOSURE");
  if (parseUtc(venue.observedAt, "venue observedAt") > current + 5 * 60_000) throw new PrivateCreditError("Venue disclosure is future-dated", "INVALID_DISCLOSURE");
}

function validateRequest(request: CreditPositionRequest): void {
  if (!request || !/^[A-Za-z0-9_.:-]{1,128}$/.test(request.requestId) || !/^[A-Za-z0-9_.:-]{1,128}$/.test(request.venueId) ||
      !/^[A-Za-z0-9_.:/-]{1,256}$/.test(request.accountReference) || !/^[A-Za-z0-9_.:-]{1,128}$/.test(request.collateralAssetId) ||
      !uint(request.collateralAmount) || !uint(request.borrowAmount)) throw new PrivateCreditError("Credit request is invalid", "INVALID_REQUEST");
}

function validatePrice(price: CollateralPrice, assetId: string, priceAsset: string, current: number, maxAgeSeconds: number): void {
  if (!price || price.assetId !== assetId || price.priceAsset !== priceAsset || !uint(price.priceAmount) || !/^[A-Za-z0-9_.:/-]{1,256}$/.test(price.sourceReference))
    throw new PrivateCreditError("Collateral price is invalid", "STALE_PRICE");
  const observed = parseUtc(price.observedAt, "price observedAt");
  if (observed < current - maxAgeSeconds * 1000 || observed > current + 5 * 60_000) throw new PrivateCreditError("Collateral price is stale or future-dated", "STALE_PRICE");
}

function uint(value: string): boolean { return typeof value === "string" && /^[1-9]\d{0,77}$/.test(value) && BigInt(value) < 2n ** 256n; }
function https(value: string): boolean { return typeof value === "string" && /^https:\/\/.+/.test(value) && value.length <= 2048; }
function validateId(value: string, field: string): void { if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(value)) throw new PrivateCreditError(`${field} is invalid`, "INVALID_REQUEST"); }
function parseUtc(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || new Date(parsed).toISOString() !== value)
    throw new PrivateCreditError(`${field} must be canonical ISO UTC`, "INVALID_REQUEST");
  return parsed;
}
