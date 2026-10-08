import { createFileRoute } from "@tanstack/react-router";
import SwapApp from "@/swap/SwapApp";

const description = "A simple private swap on Robinhood Chain. Choose what you send, what you receive, and where it should arrive.";

export const Route = createFileRoute("/swap")({
  head: () => ({
    meta: [
      { title: "Curtain Swap — Simple private swaps" },
      { name: "description", content: description },
      { property: "og:title", content: "Curtain Swap — Simple private swaps" },
      { property: "og:description", content: description },
    ],
  }),
  component: SwapApp,
});
