import { describe, expect, test } from "bun:test";
import { POOL_V4_ADDRESSES, canExecuteRoute, routeDescription, routeName } from "./routes";

describe("Swap privacy routes", () => {
  test("keeps the deployed V4 contract addresses at the Swap boundary", () => {
    expect(POOL_V4_ADDRESSES.pool).toBe("0x80334FD4160245c2856C20526349c43E8597125E");
    expect(POOL_V4_ADDRESSES.rootManager).toBe("0x0C6153A8F30fF138A4B477C5a8A702D23fBa865D");
    expect(POOL_V4_ADDRESSES.verifierAdapter).toBe("0xC5DFb62f936402005Db9ca3dC9B1177679a8a0eF");
    expect(POOL_V4_ADDRESSES.unshieldVerifierAdapter).toBe("0x84934df3E763244bA7b4989b63110B2Dae5bf682");
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
