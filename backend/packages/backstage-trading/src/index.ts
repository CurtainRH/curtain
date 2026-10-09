export interface ListedAsset {
  id: string;
  chainId: number;
  address: string;
  /** Must be independently verified by the integrator; false rejects fee/rebase/non-exact transfers. */
  exactTransfer: boolean;
  canonical: boolean;
  deployedAt: string;
  /** Integrator-supplied liquidity value in the policy's chosen reference unit. */
  liquidityValue: string;
  maxTradeAmount: string;
  enabled: boolean;
}

export interface TradingPolicy {
  minAssetAgeSeconds: number;
  minLiquidityValue: string;
  approvedVenues: string[];
}

export interface TradeRequest {
  requestId: string;
  /** Opaque account/pool reference. This toolkit never derives or links wallets. */
  accountReference: string;
  venueId: string;
  inputAssetId: string;
  outputAssetId: string;
  amountIn: string;
  minAmountOut: string;
}

export interface PreparedTrade extends TradeRequest {
  preparedAt: string;
  /** Unsigned route payload returned by the integrator's selected venue adapter. */
  route: unknown;
  status: "prepared";
}

/** The integrator selects venues, obtains quotes, and supplies unsigned route data. */
export interface TradingVenueAdapter {
  prepare(request: TradeRequest): Promise<{ route: unknown }>;
}

/** Implement with atomic request-ID uniqueness so route preparation can recover safely after failure. */
export interface BackstageTradingStore {
  getByRequest(requestId: string): Promise<PreparedTrade | undefined>;
  put(prepared: PreparedTrade): Promise<void>;
}

export interface BackstageTradingOptions {
  assets: ListedAsset[];
  policy: TradingPolicy;
  venue: TradingVenueAdapter;
  store: BackstageTradingStore;
  now?: () => number;
}

export class BackstageTradingError extends Error {
  constructor(message: string, public readonly code: "INVALID_POLICY" | "INVALID_ASSET" | "INVALID_REQUEST" | "VENUE_DENIED" | "ASSET_DENIED" | "NOT_LIQUID" | "ASSET_TOO_NEW" | "TRADE_CAP") {
    super(message);
    this.name = "BackstageTradingError";
  }
}

/**
 * In-process screening and route preparation. It is not a DEX, launch curve, broker, custodian,
 * private execution network, or price oracle. Asset metadata and venue routes are trusted only to
 * the degree the integrating application verifies them; callers must sign and execute separately.
 */
export function createBackstageTrading(options: BackstageTradingOptions) {
  const now = options.now ?? (() => Date.now());
  validatePolicy(options.policy);
  const assets = new Map<string, ListedAsset>();
  for (const asset of options.assets) {
    validateAsset(asset, now());
    if (assets.has(asset.id)) throw new BackstageTradingError("Asset IDs must be unique", "INVALID_ASSET");
    assets.set(asset.id, structuredClone(asset));
  }

  async function prepare(request: TradeRequest): Promise<PreparedTrade> {
    validateRequest(request);
    const prior = await options.store.getByRequest(request.requestId);
    if (prior) return structuredClone(prior);
    if (!options.policy.approvedVenues.includes(request.venueId)) throw new BackstageTradingError("Venue is not approved", "VENUE_DENIED");
    const input = approvedAsset(request.inputAssetId);
    const output = approvedAsset(request.outputAssetId);
    if (request.inputAssetId === request.outputAssetId) throw new BackstageTradingError("Input and output assets must differ", "INVALID_REQUEST");
    if (BigInt(request.amountIn) > BigInt(input.maxTradeAmount) || BigInt(request.minAmountOut) > BigInt(output.maxTradeAmount))
      throw new BackstageTradingError("Trade exceeds an asset cap", "TRADE_CAP");
    const prepared = await options.venue.prepare(structuredClone(request));
    if (!prepared || !("route" in prepared)) throw new BackstageTradingError("Venue adapter returned no route", "INVALID_REQUEST");
    const record: PreparedTrade = { ...structuredClone(request), route: prepared.route, preparedAt: new Date(now()).toISOString(), status: "prepared" };
    await options.store.put(record);
    return structuredClone(record);
  }

  function approvedAsset(id: string): ListedAsset {
    const asset = assets.get(id);
    if (!asset || !asset.enabled || !asset.canonical || !asset.exactTransfer) throw new BackstageTradingError("Asset is not approved for screened trading", "ASSET_DENIED");
    if (now() - Date.parse(asset.deployedAt) < options.policy.minAssetAgeSeconds * 1000) throw new BackstageTradingError("Asset has not met the minimum listing age", "ASSET_TOO_NEW");
    if (BigInt(asset.liquidityValue) < BigInt(options.policy.minLiquidityValue)) throw new BackstageTradingError("Asset has not met the minimum liquidity", "NOT_LIQUID");
    return asset;
  }

  return { prepare };
}

function validatePolicy(policy: TradingPolicy): void {
  if (!policy || !Number.isSafeInteger(policy.minAssetAgeSeconds) || policy.minAssetAgeSeconds < 0 || !uint(policy.minLiquidityValue) ||
      !Array.isArray(policy.approvedVenues) || policy.approvedVenues.length === 0 || policy.approvedVenues.some((venue) => !safeId(venue)))
    throw new BackstageTradingError("Trading policy is invalid", "INVALID_POLICY");
}

function validateAsset(asset: ListedAsset, current: number): void {
  if (!asset || !safeId(asset.id) || !Number.isSafeInteger(asset.chainId) || asset.chainId < 1 || !/^0x[\da-fA-F]{40}$/.test(asset.address) ||
      typeof asset.exactTransfer !== "boolean" || typeof asset.canonical !== "boolean" || typeof asset.enabled !== "boolean" || !uint(asset.liquidityValue) || !uint(asset.maxTradeAmount))
    throw new BackstageTradingError("Asset listing is invalid", "INVALID_ASSET");
  if (parseUtc(asset.deployedAt) > current + 5 * 60_000) throw new BackstageTradingError("Asset deployment time is in the future", "INVALID_ASSET");
}

function validateRequest(request: TradeRequest): void {
  if (!request || !safeId(request.requestId) || !/^[A-Za-z0-9_.:/-]{1,256}$/.test(request.accountReference) || !safeId(request.venueId) ||
      !safeId(request.inputAssetId) || !safeId(request.outputAssetId) || !uint(request.amountIn) || !uint(request.minAmountOut))
    throw new BackstageTradingError("Trade request is invalid", "INVALID_REQUEST");
}

function safeId(value: string): boolean { return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value); }
function uint(value: string): boolean { return typeof value === "string" && /^[1-9]\d{0,77}$/.test(value) && BigInt(value) < 2n ** 256n; }
function parseUtc(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || new Date(parsed).toISOString() !== value)
    throw new BackstageTradingError("Asset deployment time must be canonical ISO UTC", "INVALID_ASSET");
  return parsed;
}
