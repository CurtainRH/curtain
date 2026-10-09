import { describe, expect, test } from "bun:test";
import { createAiRigShelf, AiRigShelfError, type AiRigAsset, type AiRigBasket, type AiRigPrice } from "../src";

const now = Date.parse("2030-01-01T12:00:00.000Z");
const assets: AiRigAsset[] = [
  { id: "nvda", symbol: "NVDAx", name: "Example NVIDIA asset", chainId: 4663, address: "0x1111111111111111111111111111111111111111", decimals: 6, issuer: "Example issuer", termsUrl: "https://issuer.example/nvda", inKindRedemption: true },
  { id: "amd", symbol: "AMDx", name: "Example AMD asset", chainId: 4663, address: "0x2222222222222222222222222222222222222222", decimals: 6, issuer: "Example issuer", termsUrl: "https://issuer.example/amd", inKindRedemption: true },
];
const basket: AiRigBasket = { id: "ai-rig-1", name: "Example AI Rig basket", priceAsset: "USDG", maxTotalValue: "1000000000", constituents: [
  { assetId: "nvda", targetWeightBps: 6000, maxWeightBps: 7000 }, { assetId: "amd", targetWeightBps: 4000, maxWeightBps: 6000 },
] };
const prices: AiRigPrice[] = [
  { assetId: "nvda", priceAsset: "USDG", priceAmount: "10000000", observedAt: "2030-01-01T11:30:00.000Z", sourceReference: "fixture-nvda" },
  { assetId: "amd", priceAsset: "USDG", priceAmount: "5000000", observedAt: "2030-01-01T11:30:00.000Z", sourceReference: "fixture-amd" },
];
const shelf = () => { const instance = createAiRigShelf({ assets, now: () => now }); instance.defineBasket(basket); return instance; };

describe("AI Rig shelf", () => {
  test("assesses exposure and creates a deterministic rebalance plan", () => {
    const instance = shelf();
    const holdings = [{ assetId: "nvda", amount: "50000000" }, { assetId: "amd", amount: "100000000" }];
    expect(instance.assess("ai-rig-1", holdings, prices)).toMatchObject({ totalValue: "1000000000", withinLimits: true });
    expect(instance.planRebalance("rebalance-1", "ai-rig-1", holdings, prices).lines).toEqual([
      { assetId: "nvda", currentValue: "500000000", targetValue: "600000000", deltaValue: "100000000", targetAmount: "60000000" },
      { assetId: "amd", currentValue: "500000000", targetValue: "400000000", deltaValue: "-100000000", targetAmount: "80000000" },
    ]);
  });

  test("enforces basket maximums and concentration limits", () => {
    const instance = shelf();
    const concentrated = [{ assetId: "nvda", amount: "80000000" }, { assetId: "amd", amount: "10000000" }];
    expect(instance.assess("ai-rig-1", concentrated, prices)).toMatchObject({ withinLimits: false });
    expect(() => instance.planRebalance("too-large", "ai-rig-1", [{ assetId: "nvda", amount: "200000000" }], prices)).toThrow("hard maximum");
  });

  test("creates pro-rata in-kind redemption outputs without moving assets", () => {
    const instance = shelf();
    expect(instance.planInKindRedemption("redeem-1", "ai-rig-1", [{ assetId: "nvda", amount: "90000000" }, { assetId: "amd", amount: "30000000" }], "1000", "250").outputs)
      .toEqual([{ assetId: "nvda", amount: "22500000" }, { assetId: "amd", amount: "7500000" }]);
  });

  test("rejects bad weights, stale prices, unknown holdings, and invalid redemption requests", () => {
    expect(() => createAiRigShelf({ assets: [{ ...assets[0]!, address: "not-an-address" }], now: () => now })).toThrow(AiRigShelfError);
    const instance = shelf();
    expect(() => instance.defineBasket({ ...basket, id: "bad", constituents: [{ assetId: "nvda", targetWeightBps: 5000, maxWeightBps: 5000 }] })).toThrow("10,000");
    expect(() => instance.assess("ai-rig-1", [{ assetId: "other", amount: "1" }], prices)).toThrow("outside the basket");
    expect(() => instance.assess("ai-rig-1", [], [{ ...prices[0]!, observedAt: "2029-12-30T11:30:00.000Z" }, prices[1]!])).toThrow("stale");
    expect(() => instance.planInKindRedemption("replay?", "ai-rig-1", [], "1", "2")).toThrow(AiRigShelfError);
  });
});
