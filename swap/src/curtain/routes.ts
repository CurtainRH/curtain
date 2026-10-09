import type { Address } from "viem";

export type SwapRoute = "v2" | "v3" | "v4";

export interface PoolV4Addresses {
  pool: Address;
  rootManager: Address;
  verifierAdapter: Address;
  unshieldVerifierAdapter: Address;
}

export const POOL_V4_ADDRESSES: PoolV4Addresses = {
  pool: "0xA6fcb7A43aE6F26c86EA637D8BA9aaA1fd506971",
  rootManager: "0x13197b48E467A306F612D0eFBA745963E914B55F",
  verifierAdapter: "0x0a997c29065e765DF0C66FB746D2683fDfEc8fd5",
  unshieldVerifierAdapter: "0x64260f018073e5E9710A150C2a0938A4Cb57100B",
};

/** Product V4 (internally Pool V2) is enabled for the deployed pool route. */
export const POOL_V2_CLIENT_ENABLED = true;

export function routeName(route: SwapRoute): string {
  if (route === "v2") return "Curtain V2";
  if (route === "v3") return "Curtain V3";
  return "Curtain V4";
}

export function routeDescription(route: SwapRoute): string {
  if (route === "v2") return "Flexible amounts";
  if (route === "v3") return "Fixed denominations";
  return "Shielded pool route";
}

export function canExecuteRoute(route: SwapRoute): boolean {
  return route !== "v4" || POOL_V2_CLIENT_ENABLED;
}

