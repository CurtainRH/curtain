import { describe, expect, test } from "bun:test";
import { IntentError, minSplitShareBps, splitShares } from "../src/intents";

describe("split shares", () => {
  test("always sum to exactly 10 000 bps and respect the minimum share", () => {
    for (const mode of ["random", "equal"] as const) {
      for (let n = 2; n <= 5; n++) {
        for (let round = 0; round < 500; round++) {
          const shares = splitShares(n, mode);
          expect(shares.length).toBe(n);
          expect(shares.reduce((a, b) => a + b, 0)).toBe(10_000);
          for (const s of shares) {
            expect(Number.isInteger(s)).toBe(true);
            expect(s).toBeGreaterThanOrEqual(minSplitShareBps(n, mode));
          }
        }
      }
    }
  });

  test("equal shares differ by at most the rounding remainder; random shares vary", () => {
    expect(splitShares(3, "equal")).toEqual([3333, 3333, 3334]);
    const seen = new Set(Array.from({ length: 50 }, () => splitShares(3, "random").join(",")));
    expect(seen.size).toBeGreaterThan(40);
  });

  test("rejects fewer than 2 or more than 5 recipients", () => {
    for (const n of [0, 1, 6, 2.5]) expect(() => splitShares(n, "random")).toThrow(IntentError);
  });
});
