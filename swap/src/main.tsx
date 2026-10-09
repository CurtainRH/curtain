import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Buffer } from "buffer";
import SwapApp from "./SwapApp";

// The browser proof runtime includes Node-compatible packages that expect Buffer.
// Install the browser polyfill before rendering or dynamically loading the prover.
globalThis.Buffer ??= Buffer;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SwapApp />
  </StrictMode>,
);
