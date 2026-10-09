import type { Address } from "viem";

export type SwapRoute = "v2" | "v3" | "v4";

export interface PoolV4Addresses {
  pool: Address;
  rootManager: Address;
  verifierAdapter: Address;
}

export const POOL_V4_ADDRESSES: PoolV4Addresses = {
  pool: "0xC9d52aD8eABc8Cb8DF87d56a0EfC52034FDa59d9",
  rootManager: "0xDE119b0F14208A3b775664E7975d5564EF48f219",
  verifierAdapter: "0xa2D3c03A7768a30D4cCf60587c6E6dE81faCA9D8",
};

/**
 * V4 is deliberately discoverable in Swap without being accidentally executable. The current
 * client only knows the V2/V3 vault intent protocol; enabling this flag before the V4 proof and
 * settlement API exists would make a button appear to work while sending an incompatible tx.
 */
export const POOL_V4_CLIENT_ENABLED = import.meta.env["VITE_ENABLE_POOL_V4"] === "true";

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
  return route !== "v4" || POOL_V4_CLIENT_ENABLED;
}

