import type { Address } from "viem";

export type SwapRoute = "v2" | "v3" | "v4";

export interface PoolV4Addresses {
  pool: Address;
  rootManager: Address;
  verifierAdapter: Address;
  unshieldVerifierAdapter: Address;
}

export const POOL_V4_ADDRESSES: PoolV4Addresses = {
  pool: "0x80334FD4160245c2856C20526349c43E8597125E",
  rootManager: "0x0C6153A8F30fF138A4B477C5a8A702D23fBa865D",
  verifierAdapter: "0xC5DFb62f936402005Db9ca3dC9B1177679a8a0eF",
  unshieldVerifierAdapter: "0x84934df3E763244bA7b4989b63110B2Dae5bf682",
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

