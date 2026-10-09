import { describe, expect, test } from "bun:test";
import { createBackstageTrading, BackstageTradingError, type BackstageTradingStore, type PreparedTrade } from "../src";

const current = Date.parse("2030-01-01T12:00:00.000Z");
const records = new Map<string, PreparedTrade>();
const store: BackstageTradingStore = { async getByRequest(id) { return records.get(id); }, async put(value) { records.set(value.requestId, structuredClone(value)); } };
const assets = [
  { id: "usdg", chainId: 4663, address: "0x1111111111111111111111111111111111111111", exactTransfer: true, canonical: true, deployedAt: "2029-01-01T00:00:00.000Z", liquidityValue: "100000000", maxTradeAmount: "50000000", enabled: true },
  { id: "stock", chainId: 4663, address: "0x2222222222222222222222222222222222222222", exactTransfer: true, canonical: true, deployedAt: "2029-01-01T00:00:00.000Z", liquidityValue: "100000000", maxTradeAmount: "50000000", enabled: true },
];
const request = { requestId: "trade-1", accountReference: "understudy-1", venueId: "uniswap-v4", inputAssetId: "usdg", outputAssetId: "stock", amountIn: "1000000", minAmountOut: "1" };
function trading(listings = assets) { records.clear(); return createBackstageTrading({ assets: listings, policy: { minAssetAgeSeconds: 86400, minLiquidityValue: "1000000", approvedVenues: ["uniswap-v4"] }, venue: { async prepare(input) { return { route: { unsigned: true, request: input.requestId } }; } }, store, now: () => current }); }

describe("Backstage trading", () => {
  test("screens assets then prepares an unsigned route idempotently", async () => {
    const routes = trading();
    expect(await routes.prepare(request)).toMatchObject({ status: "prepared", route: { unsigned: true } });
    expect((await routes.prepare(request)).preparedAt).toBe("2030-01-01T12:00:00.000Z");
  });
  test("rejects unapproved venues, non-exact transfers, low liquidity, fresh assets, and caps", async () => {
    await expect(trading().prepare({ ...request, venueId: "unknown" })).rejects.toThrow("not approved");
    await expect(trading([{ ...assets[0]!, exactTransfer: false }, assets[1]!]).prepare(request)).rejects.toThrow("not approved");
    await expect(trading([{ ...assets[0]!, liquidityValue: "1" }, assets[1]!]).prepare(request)).rejects.toThrow("minimum liquidity");
    await expect(trading([{ ...assets[0]!, deployedAt: "2030-01-01T11:59:00.000Z" }, assets[1]!]).prepare(request)).rejects.toThrow("minimum listing age");
    await expect(trading().prepare({ ...request, amountIn: "50000001" })).rejects.toThrow("cap");
  });
  test("rejects invalid listing metadata", () => {
    expect(() => trading([{ ...assets[0]!, address: "bad" }, assets[1]!])).toThrow(BackstageTradingError);
  });
});
