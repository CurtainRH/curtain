import type { Address } from "viem";

export type SwapRoute = "v2" | "v3" | "v4";

export interface PoolV4Addresses {
  pool: Address;
  rootManager: Address;
  verifierAdapter: Address;
  unshieldVerifierAdapter: Address;
}

export const POOL_V4_ADDRESSES: PoolV4Addresses = {
  pool: "0xf8f47571A55dB8745b7642515aF051D7B1e09dd3",
  rootManager: "0xccB2e48e229435d64b42fe664dA880992C481365",
  verifierAdapter: "0x97e1a6401418d6F2B72839065C48A17c9e8Aa731",
  unshieldVerifierAdapter: "0xB7e12f83B8404019Acd7c3677B1B5026a642b8A0",
};

/** V4 remains opt-in until the deployment's Render and Vercel variables are updated together. */
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

