import { describe, expect, test } from "bun:test";
import { POOL_V4_ADDRESSES, canExecuteRoute, routeDescription, routeName } from "./routes";

describe("Swap privacy routes", () => {
  test("keeps the deployed V4 contract addresses at the Swap boundary", () => {
    expect(POOL_V4_ADDRESSES.pool).toBe("0x38147c547cDE831812CD075166E279B77FF164Cc");
    expect(POOL_V4_ADDRESSES.rootManager).toBe("0x51E2aCaC1Fe6b1915D7Eafd24b96B7781cd9AFEf");
    expect(POOL_V4_ADDRESSES.verifierAdapter).toBe("0x0a997c29065e765DF0C66FB746D2683fDfEc8fd5");
    expect(POOL_V4_ADDRESSES.unshieldVerifierAdapter).toBe("0x64260f018073e5E9710A150C2a0938A4Cb57100B");
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
