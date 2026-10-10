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

globalThis.Buffer ??= Buffer;

createRoot(document.getElementById("root")!).render(<StrictMode><QueryClientProvider client={new QueryClient()}><WagmiProvider config={wagmiConfig}><RainbowKitProvider theme={darkTheme({ accentColor: "#d9b66f", accentColorForeground: "#080d14", borderRadius: "medium" })}><App /></RainbowKitProvider></WagmiProvider></QueryClientProvider></StrictMode>);
