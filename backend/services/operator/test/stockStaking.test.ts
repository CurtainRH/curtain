import { describe, expect, test } from "bun:test";
import { estimateStockRewardUsd, splitBundleRewardUsd } from "../src/stockStaking";

describe("stock staking reward preview math", () => {
  test("matches the 4% APR and lock multipliers, rounded down like the contract", () => {
    expect(estimateStockRewardUsd(1_000_000n, 0)).toBe(3_287n);
    expect(estimateStockRewardUsd(1_000_000n, 1)).toBe(14_794n);
    expect(estimateStockRewardUsd(1_000_000n, 2)).toBe(39_452n);
  });

  test("splits by value weights and assigns rounding remainder to the final asset", () => {
    expect(splitBundleRewardUsd(101n, [3_000, 2_500, 2_500, 2_000])).toEqual([30n, 25n, 25n, 21n]);
  });

  test("rejects invalid tiers and bundle weights", () => {
    expect(() => estimateStockRewardUsd(1n, 3)).toThrow(RangeError);
    expect(() => splitBundleRewardUsd(1n, [4_000, 4_000])).toThrow(RangeError);
  });
});
