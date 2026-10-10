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
    expect(body.route.id).toBe("v2");
    expect(body.routeDisclosure).toContain("Curtain V2");
    expect(outgoing).toContain("Curtain V2");
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
