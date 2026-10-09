import { describe, expect, test } from "bun:test";
import { createRpcProxy, isReadOnlyRpcPayload } from "../src/rpc";

describe("read-only RPC proxy", () => {
  test("accepts supported read calls and JSON-RPC batches", () => {
    expect(isReadOnlyRpcPayload({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] })).toBe(true);
    expect(isReadOnlyRpcPayload([
      { jsonrpc: "2.0", id: 1, method: "eth_call", params: [] },
      { jsonrpc: "2.0", id: 2, method: "eth_blockNumber", params: [] },
    ])).toBe(true);
  });

  test("rejects transaction submission and malformed payloads", () => {
    expect(isReadOnlyRpcPayload({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [] })).toBe(false);
    expect(isReadOnlyRpcPayload({ jsonrpc: "2.0", id: 1, method: "eth_call", params: "invalid" })).toBe(false);
    expect(isReadOnlyRpcPayload([])).toBe(false);
  });

  test("relays valid read requests server-side and preserves the JSON-RPC response", async () => {
    let target = "";
    const proxy = createRpcProxy("https://rpc.internal", async (input, init) => {
      target = String(input);
      expect(init?.method).toBe("POST");
      return Response.json({ jsonrpc: "2.0", id: 1, result: "0x1237" });
    });
    const response = await proxy(new Request("https://operator.test/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    }));
    expect(target).toBe("https://rpc.internal");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jsonrpc: "2.0", id: 1, result: "0x1237" });
  });
});
