import type { Address } from "viem";

const CODEX_GRAPHQL_URL = "https://graph.codex.io/graphql";
const USDG_SCALE = 1_000_000n;
const CRTN_SCALE = 10n ** 18n;
const USD_PRICE_SCALE = 10n ** 18n;

type CodexResponse = {
  data?: { filterTokens?: { results?: { priceUSD?: string | number; liquidity?: string | number }[] } };
  errors?: { message?: string }[];
};

export type CodexPricingConfig = {
  apiKey: string;
  chainId: number;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  cacheMs?: number;
};

/** Exact decimal parser: avoids floating-point arithmetic in signed staking valuations. */
export function usdPriceToWad(raw: string): bigint {
  const match = /^(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw.trim());
  if (!match) throw new Error("Codex returned an invalid USD price");
  const exponent = Number(match[3] ?? "0");
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) throw new Error("Codex returned an invalid USD price");
  const digits = `${match[1]}${match[2] ?? ""}`;
  const shift = exponent - (match[2]?.length ?? 0) + 18;
  const value = BigInt(digits);
  return shift >= 0 ? value * 10n ** BigInt(shift) : value / 10n ** BigInt(-shift);
}

export function usdPriceToUsdg(amountCrtn: bigint, priceUsd: string): bigint {
  if (amountCrtn <= 0n) throw new Error("CRTN amount must be positive");
  const priceWad = usdPriceToWad(priceUsd);
  // USD price is converted to six-decimal USDG units (assuming USDG ≈ $1).
  return amountCrtn * priceWad * USDG_SCALE / (CRTN_SCALE * USD_PRICE_SCALE);
}

/** Server-side Codex.io market-data fallback for CRTN valuation when DEX quotes are absent. */
export function createCodexUsdgPricer(config: CodexPricingConfig) {
  const fetcher = config.fetch ?? fetch;
  const cacheMs = config.cacheMs ?? 15_000;
  let cached: { priceUsd: string; expiresAt: number } | undefined;

  async function fetchPriceUsd(token: Address): Promise<string> {
    if (cached && cached.expiresAt > Date.now()) return cached.priceUsd;
    const query = `query CurtainTokenPrice($tokens: [String!]!) {
      filterTokens(tokens: $tokens) { results { priceUSD liquidity } }
    }`;
    const response = await fetcher(CODEX_GRAPHQL_URL, {
      method: "POST",
      headers: { authorization: config.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ query, variables: { tokens: [`${token}:${config.chainId}`] } }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Codex price service returned HTTP ${response.status}`);
    const body = await response.json() as CodexResponse;
    if (body.errors?.length) throw new Error("Codex could not return a current CRTN price");
    const result = body.data?.filterTokens?.results?.[0];
    if (result?.priceUSD === undefined || result.liquidity === undefined) throw new Error("Codex has no CRTN market price on Robinhood Chain");
    const priceUsd = String(result.priceUSD);
    const price = usdPriceToWad(priceUsd);
    const liquidity = Number(result.liquidity);
    if (price <= 0n || !Number.isFinite(liquidity) || liquidity <= 0) {
      throw new Error("Codex CRTN market data is missing a valid price or liquidity");
    }
    cached = { priceUsd, expiresAt: Date.now() + cacheMs };
    return priceUsd;
  }

  return async (token: Address, amountCrtn: bigint): Promise<bigint> => {
    if (!config.apiKey.trim()) throw new Error("Codex CRTN pricing is not configured");
    return usdPriceToUsdg(amountCrtn, await fetchPriceUsd(token));
  };
}
