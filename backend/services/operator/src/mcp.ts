import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

type ApiHandler = (request: Request) => Promise<Response>;

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

/**
 * MCP surface for agents. It delegates all authenticated swap work to the existing Developer
 * API, so MCP and ordinary integrations share validation, routing, idempotency, and limits.
 */
export function createMcpApi(api: ApiHandler) {
  return createMcpHandler(
    (requestContext) => {
      const authorization = requestContext.requestInfo?.headers.get("authorization") ?? undefined;
      const callApi = async (path: string, init: RequestInit = {}, authenticated = true) => {
        if (authenticated && !authorization)
          throw new Error("This Curtain tool requires Authorization: Bearer <API key>");
        const headers = new Headers(init.headers);
        if (authorization) headers.set("authorization", authorization);
        const response = await api(
          new Request(`https://operator.curtainrh.com${path}`, { ...init, headers }),
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error((body as { error?: string }).error ?? `Curtain API HTTP ${response.status}`);
        return body;
      };

      const server = new McpServer({ name: "curtain", version: "1.0.0" });

      server.registerTool(
        "curtain_get_config",
        {
          title: "Get Curtain configuration",
          description: "Get supported tokens, vaults, privacy routes, and network limits.",
          inputSchema: z.object({}),
        },
        async () => text(await callApi("/v1/config")),
      );

      server.registerTool(
        "curtain_get_quote",
        {
          title: "Get a private swap quote",
          description: "Quote a V2, V3, or dynamically routed Curtain swap. Amounts are raw token units.",
          inputSchema: z.object({
            privacyRoute: z.enum(["v2", "v3", "dynamic"]).default("dynamic"),
            tokenIn: z.string().describe("Input token contract address"),
            tokenOut: z.string().describe("Output token contract address"),
            amountIn: z.string().describe("Positive input amount in raw token units"),
            slippageBps: z.number().int().min(0).max(5000).default(100),
          }),
        },
        async ({ privacyRoute, tokenIn, tokenOut, amountIn, slippageBps }) => {
          const query = new URLSearchParams({
            privacyRoute,
            tokenIn,
            tokenOut,
            amountIn,
            slippageBps: String(slippageBps),
          });
          return text(await callApi(`/v1/quote?${query}`));
        },
      );

      server.registerTool(
        "curtain_prepare_swap",
        {
          title: "Prepare a private swap",
          description: "Prepare unsigned approval and deposit transactions. The user's wallet must review and sign them; this tool never broadcasts funds.",
          inputSchema: z.object({
            privacyRoute: z.enum(["v2", "v3", "dynamic"]).default("dynamic"),
            tokenIn: z.string(),
            tokenOut: z.string(),
            amountIn: z.string(),
            minOut: z.string().describe("Minimum output in raw token units from a fresh quote"),
            depositor: z.string().describe("Wallet that will sign and fund the deposit"),
            recipient: z.string().describe("Wallet receiving the output"),
            delaySeconds: z.number().int().min(0).max(15_552_000).default(0),
            idempotencyKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/),
          }),
        },
        async ({ privacyRoute, tokenIn, tokenOut, amountIn, minOut, depositor, recipient, delaySeconds, idempotencyKey }) =>
          text(
            await callApi("/v1/intents", {
              method: "POST",
              headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
              body: JSON.stringify({ privacyRoute, tokenIn, tokenOut, amountIn, minOut, depositor, recipient, delaySeconds }),
            }),
          ),
      );

      server.registerTool(
        "curtain_get_intent_status",
        {
          title: "Track a Curtain swap",
          description: "Get the current status of an intent created with the authenticated API key.",
          inputSchema: z.object({ intentId: z.string().regex(/^[a-f0-9]{32}$/) }),
        },
        async ({ intentId }) => text(await callApi(`/v1/intents/${intentId}`)),
      );

      server.registerTool(
        "curtain_list_pending_settlements",
        {
          title: "List permissionless keeper settlements",
          description: "List operator-signed V2 or V3 settlements that any funded keeper wallet may submit.",
          inputSchema: z.object({ privacyRoute: z.enum(["v2", "v3"]) }),
        },
        async ({ privacyRoute }) =>
          text(await callApi(`/keeper/v1/settlements/pending?privacyRoute=${privacyRoute}`, {}, false)),
      );

      server.registerResource(
        "curtain-developer-docs",
        "curtain://developer-api",
        { title: "Curtain Developer API documentation", mimeType: "text/markdown" },
        async (uri) => ({
          contents: [{
            uri: uri.href,
            mimeType: "text/markdown",
            text: "Curtain lets agents request V2, V3, or Dynamic Privacy quotes and prepare unsigned wallet transactions. API keys authorize requests but never sign or broadcast user funds. Read https://docs.curtainrh.com for the complete API reference.",
          }],
        }),
      );

      return server;
    },
    { legacy: "stateless", responseMode: "json" },
  ).fetch;
}
