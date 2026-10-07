import { createFileRoute } from "@tanstack/react-router";
import CurtainApp from "@/components/CurtainApp";

const description =
  "Curtain Strategic Roadmap: The Five Acts of Privacy. From Robinhood Chain private swaps to institutional dark pools and sovereign credit.";

export const Route = createFileRoute("/roadmap")({
  head: () => ({
    meta: [
      { title: "Curtain — Protocol Roadmap" },
      { name: "description", content: description },
      { property: "og:title", content: "Curtain — Protocol Roadmap" },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CurtainApp,
});
