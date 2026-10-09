export interface AiRigAsset {
  id: string;
  symbol: string;
  name: string;
  chainId: number;
  address: string;
  decimals: number;
  issuer: string;
  termsUrl: string;
  /** Whether an integrator has independently confirmed this asset supports in-kind delivery. */
  inKindRedemption: boolean;
}

export interface BasketConstituent {
  assetId: string;
  targetWeightBps: number;
  /** Hard concentration ceiling; must be at least targetWeightBps. */
  maxWeightBps: number;
}

export interface AiRigBasket {
  id: string;
  name: string;
  priceAsset: string;
  /** Maximum portfolio value, in the smallest unit of priceAsset. */
  maxTotalValue: string;
  constituents: BasketConstituent[];
}

/** Price of one whole token in the smallest unit of the basket price asset. */
export interface AiRigPrice {
  assetId: string;
  priceAsset: string;
  priceAmount: string;
  observedAt: string;
  sourceReference: string;
}

export interface AiRigHolding {
  assetId: string;
  /** Asset quantity in that asset's smallest unit. */
  amount: string;
}

export interface Exposure {
  assetId: string;
  value: string;
  weightBps: number;
  limitBps: number;
  withinLimit: boolean;
}

export interface BasketAssessment {
  basketId: string;
  priceAsset: string;
  totalValue: string;
  exposures: Exposure[];
  withinLimits: boolean;
  priceObservedAt: string;
}

export interface RebalanceLine {
  assetId: string;
  currentValue: string;
  targetValue: string;
  /** Positive means acquire; negative means reduce. Value is in the basket price asset. */
  deltaValue: string;
  targetAmount: string;
}

export interface RebalancePlan {
  requestId: string;
  basketId: string;
  priceAsset: string;
  totalValue: string;
  lines: RebalanceLine[];
}

export interface InKindRedemption {
  requestId: string;
  basketId: string;
  redeemShares: string;
  totalShares: string;
  outputs: AiRigHolding[];
}

export interface AiRigShelfOptions {
  assets: AiRigAsset[];
  now?: () => number;
  /** Reject price snapshots older than this. Defaults to 24 hours. */
  maxPriceAgeSeconds?: number;
}

export class AiRigShelfError extends Error {
  constructor(message: string, public readonly code: "INVALID_ASSET" | "INVALID_BASKET" | "INVALID_PRICE" | "INVALID_HOLDINGS" | "LIMIT_EXCEEDED" | "NOT_FOUND") {
    super(message);
    this.name = "AiRigShelfError";
  }
}

/**
 * In-process portfolio planning primitives. This package does not verify an issuer, token,
 * price, venue, custody balance, or redemption. Integrators must supply and verify all of those
 * before executing any plan, and make request IDs idempotent in their own storage/settlement layer.
 */
export function createAiRigShelf(options: AiRigShelfOptions) {
  const now = options.now ?? (() => Date.now());
  const maxPriceAgeSeconds = options.maxPriceAgeSeconds ?? 24 * 60 * 60;
  if (!Array.isArray(options.assets) || options.assets.length === 0 || !Number.isSafeInteger(maxPriceAgeSeconds) || maxPriceAgeSeconds < 60) {
    throw new AiRigShelfError("A non-empty asset list and maxPriceAgeSeconds of at least 60 are required", "INVALID_ASSET");
  }
  const assets = new Map<string, AiRigAsset>();
  for (const asset of options.assets) {
    validateAsset(asset);
    if (assets.has(asset.id)) throw new AiRigShelfError("Asset IDs must be unique", "INVALID_ASSET");
    assets.set(asset.id, structuredClone(asset));
  }
  const baskets = new Map<string, AiRigBasket>();

  function defineBasket(basket: AiRigBasket): AiRigBasket {
    validateBasket(basket, assets);
    if (baskets.has(basket.id)) throw new AiRigShelfError("Basket ID already exists", "INVALID_BASKET");
    const stored = structuredClone(basket);
    baskets.set(stored.id, stored);
    return structuredClone(stored);
  }

  function getBasket(id: string): AiRigBasket | undefined {
    const basket = baskets.get(id);
    return basket ? structuredClone(basket) : undefined;
  }

  function assess(basketId: string, holdings: AiRigHolding[], prices: AiRigPrice[]): BasketAssessment {
    const basket = requiredBasket(basketId);
    const values = valueHoldings(basket, holdings, prices, assets, now(), maxPriceAgeSeconds);
    const total = values.reduce((sum, entry) => sum + entry.value, 0n);
    const constituents = new Map(basket.constituents.map((entry) => [entry.assetId, entry]));
    const exposures = basket.constituents.map((entry) => {
      const value = values.find((holding) => holding.assetId === entry.assetId)?.value ?? 0n;
      const weightBps = total === 0n ? 0 : Number((value * 10_000n) / total);
      return { assetId: entry.assetId, value: value.toString(), weightBps, limitBps: entry.maxWeightBps, withinLimit: weightBps <= entry.maxWeightBps };
    });
    if (values.some((holding) => !constituents.has(holding.assetId))) throw new AiRigShelfError("Holdings contain an asset outside the basket", "INVALID_HOLDINGS");
    const withinValue = total <= BigInt(basket.maxTotalValue);
    return {
      basketId, priceAsset: basket.priceAsset, totalValue: total.toString(), exposures,
      withinLimits: withinValue && exposures.every((exposure) => exposure.withinLimit),
      priceObservedAt: newestTimestamp(prices),
    };
  }

  function planRebalance(requestId: string, basketId: string, holdings: AiRigHolding[], prices: AiRigPrice[]): RebalancePlan {
    validateRequestId(requestId);
    const basket = requiredBasket(basketId);
    const assessment = assess(basketId, holdings, prices);
    if (!assessment.withinLimits && BigInt(assessment.totalValue) > BigInt(basket.maxTotalValue)) {
      throw new AiRigShelfError("Portfolio value exceeds the basket's hard maximum", "LIMIT_EXCEEDED");
    }
    const priceByAsset = validatedPrices(basket, prices, assets, now(), maxPriceAgeSeconds);
    const currentByAsset = new Map(valueHoldings(basket, holdings, prices, assets, now(), maxPriceAgeSeconds).map((entry) => [entry.assetId, entry.value]));
    const total = BigInt(assessment.totalValue);
    const lines = basket.constituents.map((entry) => {
      const asset = assets.get(entry.assetId)!;
      const currentValue = currentByAsset.get(entry.assetId) ?? 0n;
      const targetValue = (total * BigInt(entry.targetWeightBps)) / 10_000n;
      const price = priceByAsset.get(entry.assetId)!;
      const targetAmount = (targetValue * 10n ** BigInt(asset.decimals)) / BigInt(price.priceAmount);
      return { assetId: entry.assetId, currentValue: currentValue.toString(), targetValue: targetValue.toString(), deltaValue: (targetValue - currentValue).toString(), targetAmount: targetAmount.toString() };
    });
    return { requestId, basketId, priceAsset: basket.priceAsset, totalValue: total.toString(), lines };
  }

  function planInKindRedemption(requestId: string, basketId: string, holdings: AiRigHolding[], totalShares: string, redeemShares: string): InKindRedemption {
    validateRequestId(requestId);
    const basket = requiredBasket(basketId);
    if (!/^[1-9]\d{0,77}$/.test(totalShares) || !/^[1-9]\d{0,77}$/.test(redeemShares) || BigInt(redeemShares) > BigInt(totalShares)) {
      throw new AiRigShelfError("totalShares and redeemShares must be positive uint256 values with redeemShares no greater than totalShares", "INVALID_HOLDINGS");
    }
    const allowed = new Set(basket.constituents.map((entry) => entry.assetId));
    const seen = new Set<string>();
    const outputs = holdings.map((holding) => {
      if (!allowed.has(holding.assetId) || seen.has(holding.assetId) || !/^(0|[1-9]\d{0,77})$/.test(holding.amount)) {
        throw new AiRigShelfError("Holdings must contain unique valid basket asset amounts", "INVALID_HOLDINGS");
      }
      seen.add(holding.assetId);
      return { assetId: holding.assetId, amount: ((BigInt(holding.amount) * BigInt(redeemShares)) / BigInt(totalShares)).toString() };
    });
    return { requestId, basketId, redeemShares, totalShares, outputs };
  }

  function requiredBasket(id: string): AiRigBasket {
    const basket = baskets.get(id);
    if (!basket) throw new AiRigShelfError("Basket not found", "NOT_FOUND");
    return basket;
  }

  return { defineBasket, getBasket, assess, planRebalance, planInKindRedemption };
}

function valueHoldings(basket: AiRigBasket, holdings: AiRigHolding[], prices: AiRigPrice[], assets: Map<string, AiRigAsset>, current: number, maxPriceAgeSeconds: number): { assetId: string; value: bigint }[] {
  if (!Array.isArray(holdings)) throw new AiRigShelfError("holdings must be an array", "INVALID_HOLDINGS");
  const priceByAsset = validatedPrices(basket, prices, assets, current, maxPriceAgeSeconds);
  const seen = new Set<string>();
  return holdings.map((holding) => {
    if (!holding || seen.has(holding.assetId) || !/^(0|[1-9]\d{0,77})$/.test(holding.amount)) throw new AiRigShelfError("Holdings must have unique uint256 amounts", "INVALID_HOLDINGS");
    seen.add(holding.assetId);
    const constituent = basket.constituents.find((entry) => entry.assetId === holding.assetId);
    if (!constituent) return { assetId: holding.assetId, value: 0n };
    const price = priceByAsset.get(holding.assetId)!;
    // Asset decimals are stored alongside the price as part of the validated shelf registry.
    const decimals = assets.get(holding.assetId)!.decimals;
    return { assetId: holding.assetId, value: (BigInt(holding.amount) * BigInt(price.priceAmount)) / 10n ** BigInt(decimals) };
  });
}

function validatedPrices(basket: AiRigBasket, prices: AiRigPrice[], assets: Map<string, AiRigAsset>, current: number, maxAgeSeconds: number): Map<string, AiRigPrice> {
  const result = new Map<string, AiRigPrice>();
  if (!Array.isArray(prices)) throw new AiRigShelfError("prices must be an array", "INVALID_PRICE");
  for (const price of prices) {
    if (!price || !/^[A-Za-z0-9_.:-]{1,128}$/.test(price.assetId) || price.priceAsset !== basket.priceAsset ||
        !/^[1-9]\d{0,77}$/.test(price.priceAmount) || !canonicalUtc(price.observedAt) ||
        !/^[A-Za-z0-9_.:/-]{1,256}$/.test(price.sourceReference)) throw new AiRigShelfError("Price fields are invalid", "INVALID_PRICE");
    if (Date.parse(price.observedAt) < current - maxAgeSeconds * 1000 || Date.parse(price.observedAt) > current + 5 * 60_000) throw new AiRigShelfError("Price is stale or future-dated", "INVALID_PRICE");
    if (result.has(price.assetId)) throw new AiRigShelfError("Only one price per asset is allowed in a snapshot", "INVALID_PRICE");
    if (!assets.has(price.assetId)) throw new AiRigShelfError("Price references an unknown asset", "INVALID_PRICE");
    result.set(price.assetId, structuredClone(price));
  }
  for (const constituent of basket.constituents) if (!result.has(constituent.assetId)) throw new AiRigShelfError("Price snapshot is missing a basket asset", "INVALID_PRICE");
  return result;
}

function validateAsset(asset: AiRigAsset): void {
  if (!asset || !/^[A-Za-z0-9_.:-]{1,128}$/.test(asset.id) || !/^[A-Za-z0-9._-]{1,32}$/.test(asset.symbol) ||
      !asset.name.trim() || asset.name.length > 160 || !Number.isSafeInteger(asset.chainId) || asset.chainId < 1 ||
      !/^0x[\da-fA-F]{40}$/.test(asset.address) || !Number.isSafeInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 36 ||
      !asset.issuer.trim() || asset.issuer.length > 160 || !/^https:\/\/.+/.test(asset.termsUrl) || typeof asset.inKindRedemption !== "boolean") {
    throw new AiRigShelfError("Asset metadata is invalid", "INVALID_ASSET");
  }
}

function validateBasket(basket: AiRigBasket, assets: Map<string, AiRigAsset>): void {
  if (!basket || !/^[A-Za-z0-9_.:-]{1,128}$/.test(basket.id) || !basket.name.trim() || basket.name.length > 160 ||
      !/^[A-Za-z0-9_.:-]{1,96}$/.test(basket.priceAsset) || !/^[1-9]\d{0,77}$/.test(basket.maxTotalValue) ||
      !Array.isArray(basket.constituents) || basket.constituents.length === 0 || basket.constituents.length > 32) {
    throw new AiRigShelfError("Basket fields are invalid", "INVALID_BASKET");
  }
  let total = 0;
  const seen = new Set<string>();
  for (const entry of basket.constituents) {
    if (!assets.has(entry.assetId) || seen.has(entry.assetId) || !Number.isSafeInteger(entry.targetWeightBps) || !Number.isSafeInteger(entry.maxWeightBps) ||
        entry.targetWeightBps < 1 || entry.maxWeightBps < entry.targetWeightBps || entry.maxWeightBps > 10_000) {
      throw new AiRigShelfError("Basket constituents are invalid", "INVALID_BASKET");
    }
    seen.add(entry.assetId); total += entry.targetWeightBps;
  }
  if (total !== 10_000) throw new AiRigShelfError("Basket target weights must total 10,000 bps", "INVALID_BASKET");
}

function validateRequestId(requestId: string): void {
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(requestId)) throw new AiRigShelfError("A safe requestId is required for idempotent execution", "INVALID_HOLDINGS");
}

function canonicalUtc(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && new Date(parsed).toISOString() === value;
}

function newestTimestamp(prices: AiRigPrice[]): string {
  return prices.reduce((latest, price) => !latest || price.observedAt > latest ? price.observedAt : latest, "");
}
