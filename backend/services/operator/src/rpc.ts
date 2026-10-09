const READ_METHODS = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getProof",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_call",
  "eth_maxPriorityFeePerGas",
  "net_version",
]);

const MAX_BODY_BYTES = 100_000;
const MAX_BATCH_SIZE = 50;

export function isReadOnlyRpcPayload(payload: unknown): boolean {
  const requests = Array.isArray(payload) ? payload : [payload];
  return requests.length > 0 && requests.length <= MAX_BATCH_SIZE && requests.every((item) => {
    if (!item || typeof item !== "object") return false;
    const request = item as Record<string, unknown>;
    return request["jsonrpc"] === "2.0"
      && typeof request["method"] === "string"
      && READ_METHODS.has(request["method"])
      && (request["params"] === undefined || Array.isArray(request["params"]) || (typeof request["params"] === "object" && request["params"] !== null));
  });
}

export function createRpcProxy(
  rpcUrl: string,
  fetcher: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = fetch,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return Response.json({ error: "RPC proxy only accepts POST" }, { status: 405, headers: { allow: "POST" } });
    }
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_BODY_BYTES) return Response.json({ error: "RPC request too large" }, { status: 413 });

    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      return Response.json({ error: "RPC request too large" }, { status: 413 });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return Response.json({ error: "Invalid JSON-RPC payload" }, { status: 400 });
    }
    if (!isReadOnlyRpcPayload(payload)) {
      return Response.json({ error: "Only allowlisted read-only JSON-RPC methods are available" }, { status: 403 });
    }

    try {
      const upstream = await fetcher(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
      });
    } catch {
      return Response.json({ error: "Upstream RPC is temporarily unavailable" }, { status: 502 });
    }
  };
}
