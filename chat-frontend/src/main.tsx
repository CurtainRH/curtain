import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { wagmiConfig } from "./wagmi";
import App from "./App";
import { Buffer } from "buffer";
import "@rainbow-me/rainbowkit/styles.css";
import "./style.css";
import "./rebrand.css";

globalThis.Buffer ??= Buffer;

createRoot(document.getElementById("root")!).render(<StrictMode><QueryClientProvider client={new QueryClient()}><WagmiProvider config={wagmiConfig}><RainbowKitProvider theme={darkTheme({ accentColor: "#ff6a1a", accentColorForeground: "#0b0b0b", borderRadius: "medium" })}><App /></RainbowKitProvider></WagmiProvider></QueryClientProvider></StrictMode>);
