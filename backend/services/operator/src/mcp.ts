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
            integratorFee: z.object({ recipient: z.string(), bps: z.number().int().min(0).max(100) }).optional(),
          }),
        },
        async ({ privacyRoute, tokenIn, tokenOut, amountIn, slippageBps, integratorFee }) => {
          const query = new URLSearchParams({
            privacyRoute,
            tokenIn,
            tokenOut,
            amountIn,
            slippageBps: String(slippageBps),
          });
          if (integratorFee) {
            query.set("integratorFeeRecipient", integratorFee.recipient);
            query.set("integratorFeeBps", String(integratorFee.bps));
          }
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
            integratorFee: z.object({ recipient: z.string(), bps: z.number().int().min(0).max(100) }).optional(),
            delaySeconds: z.number().int().min(0).max(15_552_000).default(0),
            idempotencyKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/),
          }),
        },
        async ({ privacyRoute, tokenIn, tokenOut, amountIn, minOut, depositor, recipient, integratorFee, delaySeconds, idempotencyKey }) =>
          text(
            await callApi("/v1/intents", {
              method: "POST",
              headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
              body: JSON.stringify({ privacyRoute, tokenIn, tokenOut, amountIn, minOut, depositor, recipient, integratorFee, delaySeconds }),
            }),
          ),
      );

      server.registerTool(
        "curtain_batch_get_quotes",
        {
          title: "Get multiple private swap quotes",
          description: "Quote up to eight V2, V3, or dynamically routed swaps concurrently in one MCP call. Useful when an agent is comparing routes or assets.",
          inputSchema: z.object({
            quotes: z.array(z.object({
              privacyRoute: z.enum(["v2", "v3", "dynamic"]).default("dynamic"),
              tokenIn: z.string(),
              tokenOut: z.string(),
              amountIn: z.string(),
              slippageBps: z.number().int().min(0).max(5000).default(100),
              integratorFee: z.object({ recipient: z.string(), bps: z.number().int().min(0).max(100) }).optional(),
            })).min(1).max(8),
          }),
        },
        async ({ quotes }) => text(await Promise.all(quotes.map(async ({ privacyRoute, tokenIn, tokenOut, amountIn, slippageBps, integratorFee }) => {
          const query = new URLSearchParams({ privacyRoute, tokenIn, tokenOut, amountIn, slippageBps: String(slippageBps) });
          if (integratorFee) {
            query.set("integratorFeeRecipient", integratorFee.recipient);
            query.set("integratorFeeBps", String(integratorFee.bps));
          }
          return { request: { privacyRoute, tokenIn, tokenOut, amountIn }, quote: await callApi(`/v1/quote?${query}`) };
        }))),
      );

      server.registerTool(
        "curtain_quote_and_prepare_swap",
        {
          title: "Quote and prepare a private swap",
          description: "Get a fresh quote and prepare unsigned approval and deposit transactions in one call. The user's wallet must review and sign them; this tool never broadcasts funds.",
          inputSchema: z.object({
            privacyRoute: z.enum(["v2", "v3", "dynamic"]).default("dynamic"),
            tokenIn: z.string(),
            tokenOut: z.string(),
            amountIn: z.string(),
            minOut: z.string().optional().describe("Optional explicit minimum output in raw token units; defaults to the fresh quote's minOutSuggested"),
            depositor: z.string().describe("Wallet that will sign and fund the deposit"),
            recipient: z.string().describe("Wallet receiving the output"),
            integratorFee: z.object({ recipient: z.string(), bps: z.number().int().min(0).max(100) }).optional(),
            delaySeconds: z.number().int().min(0).max(15_552_000).default(0),
            orderType: z.enum(["market", "limit"]).default("market"),
            expiresInSeconds: z.number().int().min(60).max(15_552_000).optional(),
            slippageBps: z.number().int().min(0).max(5000).default(100),
            idempotencyKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/),
          }),
        },
        async ({ privacyRoute, tokenIn, tokenOut, amountIn, minOut, depositor, recipient, integratorFee, delaySeconds, orderType, expiresInSeconds, slippageBps, idempotencyKey }) => {
          const query = new URLSearchParams({ privacyRoute, tokenIn, tokenOut, amountIn, slippageBps: String(slippageBps) });
          if (integratorFee) {
            query.set("integratorFeeRecipient", integratorFee.recipient);
            query.set("integratorFeeBps", String(integratorFee.bps));
          }
          const quote = await callApi(`/v1/quote?${query}`);
          const quoteBody = quote as { available?: boolean; minOutSuggested?: string };
          if (!quoteBody.available) throw new Error("No quote is available for this pair right now");
          const prepared = await callApi("/v1/intents", {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
            body: JSON.stringify({
              privacyRoute, tokenIn, tokenOut, amountIn,
              minOut: minOut ?? quoteBody.minOutSuggested,
              depositor, recipient, integratorFee, delaySeconds, orderType,
              ...(expiresInSeconds !== undefined ? { expiresInSeconds } : {}),
            }),
          });
          return text({ quote, prepared });
        },
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
            text: "Curtain lets agents request V2, V3, or Dynamic Privacy quotes, batch quote up to eight swaps concurrently, prepare unsigned wallet transactions, and combine quote plus preparation in one call. API keys authorize requests but never sign or broadcast user funds. Read https://docs.curtainrh.com for the complete API reference.",
          }],
        }),
      );

      return server;
    },
    { legacy: "stateless", responseMode: "json" },
  ).fetch;
}
