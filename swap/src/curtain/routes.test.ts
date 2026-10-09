import { describe, expect, test } from "bun:test";
import { POOL_V4_ADDRESSES, canExecuteRoute, routeDescription, routeName } from "./routes";

describe("Swap privacy routes", () => {
  test("keeps the deployed V4 contract addresses at the Swap boundary", () => {
    expect(POOL_V4_ADDRESSES.pool).toBe("0xC9d52aD8eABc8Cb8DF87d56a0EfC52034FDa59d9");
    expect(POOL_V4_ADDRESSES.rootManager).toBe("0xDE119b0F14208A3b775664E7975d5564EF48f219");
    expect(POOL_V4_ADDRESSES.verifierAdapter).toBe("0xa2D3c03A7768a30D4cCf60587c6E6dE81faCA9D8");
  });

  test("describes the three product routes without exposing Solidity naming", () => {
    expect(routeName("v2")).toBe("Curtain V2");
    expect(routeDescription("v2")).toBe("Flexible amounts");
    expect(routeName("v3")).toBe("Curtain V3");
    expect(routeDescription("v3")).toBe("Fixed denominations");
    expect(routeName("v4")).toBe("Curtain V4");
    expect(routeDescription("v4")).toBe("Shielded pool route");
  });

  test("never enables an executable V4 swap through the old vault client", () => {
    expect(canExecuteRoute("v2")).toBe(true);
    expect(canExecuteRoute("v3")).toBe(true);
    expect(canExecuteRoute("v4")).toBe(false);
  });
});
