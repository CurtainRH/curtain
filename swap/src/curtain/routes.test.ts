import { describe, expect, test } from "bun:test";
import { POOL_V4_ADDRESSES, canExecuteRoute, routeDescription, routeName } from "./routes";

describe("Swap privacy routes", () => {
  test("keeps the deployed V4 contract addresses at the Swap boundary", () => {
    expect(POOL_V4_ADDRESSES.pool).toBe("0xA6fcb7A43aE6F26c86EA637D8BA9aaA1fd506971");
    expect(POOL_V4_ADDRESSES.rootManager).toBe("0x13197b48E467A306F612D0eFBA745963E914B55F");
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

  test("allows the deployed Pool V2 contract through the V4 product route", () => {
    expect(canExecuteRoute("v2")).toBe(true);
    expect(canExecuteRoute("v3")).toBe(true);
    expect(canExecuteRoute("v4")).toBe(true);
  });
});
