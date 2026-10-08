import { createFileRoute } from "@tanstack/react-router";
import CurtainApp from "@/components/CurtainApp";

const description =
  "Curtain Technical Whitepaper: Non-custodial private swaps, atomic settlements, and cryptographic escape hatches for tokenized real-world assets on Robinhood Chain.";

export const Route = createFileRoute("/whitepaper")({
  head: () => ({
    meta: [
      { title: "Curtain — Protocol Whitepaper" },
      { name: "description", content: description },
      { property: "og:title", content: "Curtain — Protocol Whitepaper" },
      { property: "og:description", content: description },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CurtainApp,
});
