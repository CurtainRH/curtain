import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import SwapApp from "./SwapApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SwapApp />
  </StrictMode>,
);
