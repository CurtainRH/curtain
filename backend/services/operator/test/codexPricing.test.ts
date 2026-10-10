import { describe, expect, test } from "bun:test";
import type { Address } from "viem";
import { createCodexUsdgPricer, usdPriceToUsdg } from "../src/codexPricing";

const CRTN = "0x66A844fcbf4705Dbde3c97394d5a4C9822E8F35b" as Address;

describe("Codex CRTN staking valuation fallback", () => {
  test("converts the returned USD price to six-decimal USDG without floats", () => {
    expect(usdPriceToUsdg(2n * 10n ** 18n, "1.23456789")).toBe(2_469_135n);
  });

  test("queries only the configured chain/token and caches a valid liquid price briefly", async () => {
    let calls = 0;
    let sent: { authorization?: string; body?: string } = {};
    const fetcher: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = async (input, init) => {
      calls++;
      sent = { authorization: new Headers(init?.headers).get("authorization") ?? undefined, body: String(init?.body) };
      return Response.json({ data: { filterTokens: { results: [{ priceUSD: "2.50", liquidity: "12000" }] } } });
    };
    const price = createCodexUsdgPricer({ apiKey: "test-secret", chainId: 4663, fetch: fetcher, cacheMs: 60_000 });

    expect(await price(CRTN, 3n * 10n ** 18n)).toBe(7_500_000n);
    expect(await price(CRTN, 1n * 10n ** 18n)).toBe(2_500_000n);
    expect(calls).toBe(1);
    expect(sent.authorization).toBe("test-secret");
    expect(sent.body).toContain(`${CRTN}:4663`);
  });

  test("rejects missing or illiquid Codex market data", async () => {
    const noLiquidity: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = async () => Response.json({ data: { filterTokens: { results: [{ priceUSD: "1.25", liquidity: "0" }] } } });
    const price = createCodexUsdgPricer({ apiKey: "test-secret", chainId: 4663, fetch: noLiquidity });
    await expect(price(CRTN, 10n ** 18n)).rejects.toThrow("missing a valid price or liquidity");
  });
});
