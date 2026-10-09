import type { Address } from "viem";

export type SwapRoute = "v2" | "v3" | "v4";

export interface PoolV4Addresses {
  pool: Address;
  rootManager: Address;
  verifierAdapter: Address;
  unshieldVerifierAdapter: Address;
}

export const POOL_V4_ADDRESSES: PoolV4Addresses = {
  pool: "0x38147c547cDE831812CD075166E279B77FF164Cc",
  rootManager: "0x51E2aCaC1Fe6b1915D7Eafd24b96B7781cd9AFEf",
  verifierAdapter: "0x0a997c29065e765DF0C66FB746D2683fDfEc8fd5",
  unshieldVerifierAdapter: "0x64260f018073e5E9710A150C2a0938A4Cb57100B",
};

/**
 * Product V4 (internally Pool V2) is paused pending a corrected pool flow.
 * This is deliberately source-controlled so a stale hosted environment value
 * cannot re-enable it.
 */
export const POOL_V2_CLIENT_ENABLED = false;

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

