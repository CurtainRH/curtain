import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http, defineChain } from "viem";

export const chain = defineChain({
  id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["/api/rpc"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});
export const wagmiConfig = getDefaultConfig({
  appName: "Curtain Chat", projectId: "c18f88bf867a57a1e0b57cfba6308cf2", chains: [chain],
  transports: { [chain.id]: http("/api/rpc", { retryCount: 2, timeout: 12_000 }) }, ssr: false,
});
