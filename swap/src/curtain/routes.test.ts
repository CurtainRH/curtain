import { describe, expect, test } from "bun:test";
import { POOL_V4_ADDRESSES, canExecuteRoute, routeDescription, routeName } from "./routes";

describe("Swap privacy routes", () => {
  test("keeps the deployed V4 contract addresses at the Swap boundary", () => {
    expect(POOL_V4_ADDRESSES.pool).toBe("0xf8f47571A55dB8745b7642515aF051D7B1e09dd3");
    expect(POOL_V4_ADDRESSES.rootManager).toBe("0xccB2e48e229435d64b42fe664dA880992C481365");
    expect(POOL_V4_ADDRESSES.verifierAdapter).toBe("0x97e1a6401418d6F2B72839065C48A17c9e8Aa731");
    expect(POOL_V4_ADDRESSES.unshieldVerifierAdapter).toBe("0xB7e12f83B8404019Acd7c3677B1B5026a642b8A0");
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
