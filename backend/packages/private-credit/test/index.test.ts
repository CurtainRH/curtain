import { describe, expect, test } from "bun:test";
import { createPrivateCreditToolkit, PrivateCreditError, type OutsidePosition, type PrivateCreditStore } from "../src";

const current = Date.parse("2030-01-01T12:00:00.000Z");
const positions = new Map<string, OutsidePosition>();
const byRequest = new Map<string, string>();
const store: PrivateCreditStore = {
  async getByRequest(id) { const position = byRequest.get(id); return position ? positions.get(position) : undefined; },
  async get(id) { return positions.get(id); },
  async put(position) { positions.set(position.id, structuredClone(position)); byRequest.set(position.requestId, position.id); },
};
const request = { requestId: "credit-1", venueId: "morpho-isolated", accountReference: "understudy-42", collateralAssetId: "nvda", collateralAmount: "10000000", borrowAmount: "5000000" };
function toolkit(priceObservedAt = "2030-01-01T11:55:00.000Z") {
  positions.clear(); byRequest.clear();
  return createPrivateCreditToolkit({
    policy: { priceAsset: "USDG", maxBorrowAmount: "8000000", maxPriceAgeSeconds: 900, collateral: [{ assetId: "nvda", decimals: 6, maxLoanToValueBps: 6000, maxCollateralAmount: "20000000" }] },
    venues: [{ venueId: "morpho-isolated", name: "Example isolated market", termsUrl: "https://venue.example/terms", backingDisclosureUrl: "https://venue.example/backing", observedBorrowRateBps: 700, observedAt: "2030-01-01T11:55:00.000Z", venueSeesPositionAndLiquidation: true }],
    prices: { async get() { return { assetId: "nvda", priceAsset: "USDG", priceAmount: "10000000", observedAt: priceObservedAt, sourceReference: "fixture-price" }; } },
    adapter: { async open() { return { externalPositionId: "venue-position-1" }; }, async close() {} }, store, now: () => current,
  });
}

describe("private credit and outside positions", () => {
  test("quotes, opens idempotently, closes, and makes venue visibility explicit", async () => {
    const credit = toolkit();
    expect(await credit.quote(request)).toMatchObject({ collateralValue: "100000000", maxPermittedBorrow: "8000000" });
    const opened = await credit.open(request);
    expect(opened).toMatchObject({ status: "open", venueSeesPositionAndLiquidation: true });
    expect((await credit.open(request)).id).toBe(opened.id);
    expect((await credit.close({ positionId: opened.id, requestId: "close-1" })).status).toBe("closed");
  });

  test("enforces collateral, LTV, stale-price, and liquidation boundaries", async () => {
    await expect(toolkit().quote({ ...request, borrowAmount: "9000000" })).rejects.toThrow("exceeds collateral");
    await expect(toolkit().quote({ ...request, collateralAmount: "30000000" })).rejects.toThrow("Collateral amount");
    await expect(toolkit("2030-01-01T11:30:00.000Z").quote(request)).rejects.toThrow("stale");
    const credit = toolkit(); const opened = await credit.open(request);
    expect((await credit.recordLiquidation(opened.id, "2030-01-01T12:00:00.000Z")).status).toBe("liquidated");
    await expect(credit.close({ positionId: opened.id, requestId: "close-after-liquidation" })).rejects.toThrow(PrivateCreditError);
  });

  test("rejects a venue disclosure that tries to hide venue visibility", () => {
    expect(() => createPrivateCreditToolkit({
      policy: { priceAsset: "USDG", maxBorrowAmount: "1", collateral: [{ assetId: "nvda", decimals: 6, maxLoanToValueBps: 1, maxCollateralAmount: "1" }] },
      venues: [{ venueId: "bad", name: "bad", termsUrl: "https://x.example", backingDisclosureUrl: "https://x.example", observedBorrowRateBps: 1, observedAt: "2030-01-01T11:55:00.000Z", venueSeesPositionAndLiquidation: false } as never],
      prices: { async get() { throw new Error("unused"); } }, adapter: { async open() { return { externalPositionId: "x" }; }, async close() {} }, store, now: () => current,
    })).toThrow("Venue disclosure");
  });
});
