import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { wagmiConfig } from "@/lib/wagmi";
import "@rainbow-me/rainbowkit/styles.css";

const CurtainExperience = lazy(() => import("@/curtain/entry"));

/**
 * The Curtain experience owns its own in-page navigation, audio, GSAP curtain
 * transitions and wallet reads, so it renders in the browser only.
 */
export default function CurtainApp() {
  return (
    <ClientOnly fallback={<div style={{ minHeight: "100vh", background: "#091323" }} />}>
      <Suspense fallback={<div style={{ minHeight: "100vh", background: "#091323" }} />}>
        <WagmiProvider config={wagmiConfig}>
          <RainbowKitProvider
            theme={darkTheme({
              accentColor: "#c5a059",
              accentColorForeground: "#080c14",
              borderRadius: "medium",
            })}
          >
            <CurtainExperience />
          </RainbowKitProvider>
        </WagmiProvider>
      </Suspense>
    </ClientOnly>
  );
}
