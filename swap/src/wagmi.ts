import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { chain } from "./curtain/integration";

export const wagmiConfig = getDefaultConfig({
  appName: "Curtain",
  projectId:
    (import.meta.env["VITE_WALLETCONNECT_PROJECT_ID"] as string | undefined) ||
    "c18f88bf867a57a1e0b57cfba6308cf2",
  chains: [chain],
  ssr: false,
});
