import { describe, expect, test } from "bun:test";
import { pgliteDb } from "@curtain/db/pglite";
import { createApi } from "../src/api";
import type { Operator } from "../src/operator";

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const;
const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" as const;
const makeApi = async (provider: (input: string | URL | Request, init?: RequestInit) => Promise<Response>, enabled = true) => createApi({
  db: await pgliteDb(), operator: {} as Operator, vault: "0xF9381841e982648c178E762116A437Ecbcf12Bbd",
  tokens: { USDG, NVDA }, keeperFeeBps: 5,
  ...(enabled ? { chat: { apiKey: "test-only", model: "qwen-test", fetch: provider } } : {}),
});
const post = (api: ReturnType<typeof createApi>, ip: string, message = "Swap 10 USDG to NVDA") => api(new Request("http://operator/chat/interpret", {
  method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ message }),
}));

describe("Curtain Chat interpretation", () => {
  test("validates model swap fields and fixes the disclosed route to V2", async () => {
    let outgoing = "";
    const api = await makeApi(async (_input, init) => {
      outgoing = String(init?.body);
      return Response.json({ choices: [{ message: { content: JSON.stringify({ reply: "I prepared your swap.", action: { type: "swap", amount: "10", tokenIn: "USDG", tokenOut: "NVDA" } }) } }] });
    });
    const response = await post(api, "chat-test-v2");
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(body.action).toEqual({ type: "swap", amount: "10", tokenIn: "USDG", tokenOut: "NVDA" });
    expect(body.route).toBeUndefined();
    expect(body.reply).toContain("Nothing is sent until you approve");
    expect(outgoing).toContain("Dynamic Privacy selects the route on the server");
    expect(outgoing).not.toContain("V3");
  });

  test("rejects unsupported symbols instead of returning an executable proposal", async () => {
    const api = await makeApi(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ reply: "Swap it.", action: { type: "swap", amount: "1", tokenIn: "USDG", tokenOut: "UNKNOWN" } }) } }] }));
    const response = await post(api, "chat-test-invalid");
    expect(response.status).toBe(422);
  });

  test("does not call Groq when chat is not configured", async () => {
    const api = await makeApi(async () => { throw new Error("must not call provider"); }, false);
    expect((await post(api, "chat-test-disabled")).status).toBe(503);
  });

  test("bounds request size and natural-language length", async () => {
    const api = await makeApi(async () => { throw new Error("must not call provider"); });
    const oversized = await api(new Request("http://operator/chat/interpret", { method: "POST", body: JSON.stringify({ message: "x".repeat(9_000) }) }));
    expect(oversized.status).toBe(413);
    expect((await post(api, "chat-test-empty", " ")).status).toBe(400);
  });
});

describe("Curtain Chat Dynamic Privacy routing", () => {
  const routeRequest = (api: ReturnType<typeof createApi>, ip: string, amountIn: string, excludeV4 = false) => api(new Request("http://operator/chat/route", {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ tokenIn: USDG, tokenOut: NVDA, amountIn, excludeV4 }),
  }));
  const configuredApi = async ({ v4Available = false, fixed = false }: { v4Available?: boolean; fixed?: boolean }) => {
    const quote = async () => ({ available: true, expectedOut: "900", minOutSuggested: "890", marketOut: "900", minOut: "890", venue: "uniswap-v3" });
    const v2 = { quoteForUser: quote, quoteForPool: async () => v4Available ? { available: true, marketOut: "1000", minOut: "990", venue: "uniswap-v4", router: NVDA, data: "0x1234" } : { available: false } } as unknown as Operator;
    const v3 = { quoteForUser: quote } as unknown as Operator;
    const db = await pgliteDb();
    const routeMessage = async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      const selectedRoute = JSON.parse(request.messages[1].content).selectedRoute;
      return Response.json({ choices: [{ message: { content: JSON.stringify({ reply: `For this swap, I’ll use ${selectedRoute}. Nothing is sent until you approve in your wallet.` }) } }] });
    };
    return createApi({
      db, operator: v2, vault: "0xF9381841e982648c178E762116A437Ecbcf12Bbd", tokens: { USDG, NVDA }, keeperFeeBps: 5,
      chat: { apiKey: "test-only", model: "qwen-test", fetch: routeMessage },
      poolV4: { publisher: {} as any, pool: "0xA6fcb7A43aE6F26c86EA637D8BA9aaA1fd506971", rootManager: "0x13197b48E467A306F612D0eFBA745963E914B55F" },
      contexts: {
        v2: { db, operator: v2, vault: "0xF9381841e982648c178E762116A437Ecbcf12Bbd", tokens: { USDG, NVDA }, keeperFeeBps: 5, poolV4: { publisher: {} as any, pool: "0xA6fcb7A43aE6F26c86EA637D8BA9aaA1fd506971", rootManager: "0x13197b48E467A306F612D0eFBA745963E914B55F" } },
        v3: { db, operator: v3, vault: "0xBF643c56D6f1775f9ABe97b7B7e89b0265D6c67a", tokens: { USDG, NVDA }, keeperFeeBps: 5, v3Mode: true, fixedAmounts: fixed ? new Set([`${USDG}:10000000`]) : new Set() },
      },
    });
  };
  test("prefers the shielded-pool product route when its quote is available", async () => {
    const api = await configuredApi({ v4Available: true, fixed: true });
    const response = await routeRequest(api, "chat-route-v4", "10000000");
    const body = await response.json() as any;
    expect(body.route.id).toBe("v4");
    expect(body.reply).toContain("Curtain V4");
    expect(body.quote.minOutSuggested).toBe("990");
  });
  test("falls back to V3 only for a configured fixed denomination, otherwise V2", async () => {
    const v3Api = await configuredApi({ v4Available: true, fixed: true });
    const v3 = await (await routeRequest(v3Api, "chat-route-v3", "10000000", true)).json() as any;
    expect(v3.route.id).toBe("v3");
    const v2Api = await configuredApi({ fixed: true });
    const v2 = await (await routeRequest(v2Api, "chat-route-v2", "11000000")).json() as any;
    expect(v2.route.id).toBe("v2");
  });
});
