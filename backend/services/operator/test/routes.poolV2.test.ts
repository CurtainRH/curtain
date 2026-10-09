import { describe, expect, test } from "bun:test";
import { decodeFunctionData, parseAbi, type Address } from "viem";
import { uniswapRoute } from "../src/routes";

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address;
const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" as Address;
const POOL = "0x1111111111111111111111111111111111111111" as Address;

describe("Pool V2 exact-output swap calldata", () => {
  test("uses Uniswap V3 exact output and caps input at the user's deposit", () => {
    const data = uniswapRoute()({
      vault: POOL, tokenIn: USDG, tokenOut: NVDA, amountIn: 500_000n, minOut: 2_100_000_000_000_000n,
      exactOutput: true, fee: 500,
    });
    const decoded = decodeFunctionData({
      abi: parseAbi([
        "struct ExactOutputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountOut; uint256 amountInMaximum; uint160 sqrtPriceLimitX96; }",
        "function exactOutputSingle(ExactOutputSingleParams params) payable returns (uint256 amountIn)",
      ]), data,
    });
    expect(decoded.functionName).toBe("exactOutputSingle");
    expect(decoded.args[0]).toMatchObject({ tokenIn: USDG, tokenOut: NVDA, fee: 500, recipient: POOL, amountOut: 2_100_000_000_000_000n, amountInMaximum: 500_000n });
  });

  test("uses the allowlisted Uniswap V4 adapter exact-output entrypoint", () => {
    const data = uniswapRoute()({
      vault: POOL, tokenIn: USDG, tokenOut: NVDA, amountIn: 500_000n, minOut: 2_100_000_000_000_000n,
      exactOutput: true, v4: { key: { currency0: USDG, currency1: NVDA, fee: 500, tickSpacing: 10, hooks: "0x0000000000000000000000000000000000000000" }, zeroForOne: true },
    });
    const decoded = decodeFunctionData({
      abi: parseAbi([
        "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
        "function swapExactOut(PoolKey key, bool zeroForOne, uint256 amountOut, uint256 maxIn, address recipient) returns (uint256 amountIn)",
      ]), data,
    });
    expect(decoded.functionName).toBe("swapExactOut");
    expect(decoded.args[0]).toMatchObject({ currency0: USDG, currency1: NVDA, fee: 500, tickSpacing: 10 });
    expect(decoded.args.slice(1)).toEqual([true, 2_100_000_000_000_000n, 500_000n, POOL]);
  });
});
