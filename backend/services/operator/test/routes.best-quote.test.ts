import { describe, expect, test } from "bun:test";
import type { Address } from "viem";
import { uniswapQuoter } from "../src/routes";

const TOKEN_IN = "0x0000000000000000000000000000000000000001" as Address;
const TOKEN_OUT = "0x0000000000000000000000000000000000000002" as Address;
const V3_ROUTER = "0x0000000000000000000000000000000000000003" as Address;
const V3_QUOTER = "0x0000000000000000000000000000000000000004" as Address;
const V4_ADAPTER = "0x0000000000000000000000000000000000000005" as Address;
const V4_QUOTER = "0x0000000000000000000000000000000000000006" as Address;

describe("best-of-Uniswap staking quotes", () => {
  test("checks V3 and V4 and returns the venue with the highest output", async () => {
    const client = {
      simulateContract: async ({ address, args }: { address: Address; args: readonly unknown[] }) => {
        if (address === V3_QUOTER) {
          const params = args[0] as { fee: number };
          return { result: [BigInt(params.fee)] };
        }
        const params = args[0] as { poolKey: { fee: number } };
        return { result: [BigInt(params.poolKey.fee) * 2n, 0n] };
      },
    };
    const quote = uniswapQuoter({ client: client as never, v3Router: V3_ROUTER, v3Quoter: V3_QUOTER, v4Adapter: V4_ADAPTER, v4Quoter: V4_QUOTER });

    const best = await quote(TOKEN_IN, TOKEN_OUT, 1_000n);
    expect(best.amountOut).toBe(20_000n);
    expect(best.router).toBe(V4_ADAPTER);
    expect(best.v4?.key.fee).toBe(10_000);
  });

  test("uses V3 when its quote beats every available V4 pool", async () => {
    const client = {
      simulateContract: async ({ address, args }: { address: Address; args: readonly unknown[] }) => {
        if (address === V3_QUOTER) {
          const params = args[0] as { fee: number };
          return { result: [BigInt(params.fee) * 5n] };
        }
        const params = args[0] as { poolKey: { fee: number } };
        return { result: [BigInt(params.poolKey.fee), 0n] };
      },
    };
    const quote = uniswapQuoter({ client: client as never, v3Router: V3_ROUTER, v3Quoter: V3_QUOTER, v4Adapter: V4_ADAPTER, v4Quoter: V4_QUOTER });

    const best = await quote(TOKEN_IN, TOKEN_OUT, 1_000n);
    expect(best.amountOut).toBe(50_000n);
    expect(best.router).toBe(V3_ROUTER);
    expect(best.fee).toBe(10_000);
    expect(best.v4).toBeUndefined();
  });
});
