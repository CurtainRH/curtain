/**
 * Server-side proxy for Curtain Operator API and Lovable media assets.
 * Executes backend API calls server-side and relays them to the browser client,
 * keeping operator endpoints private and providing clean offline fallbacks.
 */

const DEFAULT_TOKENS: Record<string, string> = {
  AAPL: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
  AMC: "0x05a3d1Cd21d0C88145E82600E62e7E496e0F222B",
  AMD: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC",
  AMZN: "0x12f190a9F9d7D37a250758b26824B97CE941bF54",
  BA: "0x4D21483a44Bf67a86b77E3dA301411880797D452",
  COIN: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b",
  COST: "0x4EA005168D7F09a7A0Ba9D1DEf21a479950E44C2",
  CRCL: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5",
  DELL: "0x941AE714EC6D8130c7B75d67160Ca08f1e7d11Dd",
  DJT: "0x1D11f0496982706C5e14A514D4E79F2e6BdE4516",
  F: "0x25C288E6D899b9BC30160965aD9644c67e73bE0C",
  GLD: "0xC9a981FEE1F9DEc688bb123ccDeCc63D0deBFC4e",
  GLXY: "0x2D427692E928fa156ec22acfaBaFA0447C5805B7",
  GME: "0x1b0E319c6A659F002271B69dB8A7df2F911c153E",
  GOOGL: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3",
  HIMS: "0xCceE82fE024c36fA15E1005edE3E9e4787e23D09",
  IBM: "0x980dcf6766FA79f5Cf0c4AAdb3ab477ff15a9619",
  INTC: "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681",
  JNJ: "0x03DfbBE0AC4E7bCDaFd08eD41A400326B77D8c80",
  LLY: "0x8005d266423c7ea827372c9c864491e5786600ea",
  META: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35",
  MSFT: "0xe93237C50D904957Cf27E7B1133b510C669c2e74",
  MSTR: "0xec262a75e413fAfD0dF80480274532C79D42da09",
  NFLX: "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8",
  NVDA: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
  PFE: "0x7066A64c24e4206CD62E83bf198c1E7EB361F51e",
  PLTR: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A",
  QQQ: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68",
  RBLX: "0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8",
  RDDT: "0x05b37Fb53A299a1b874A619e1c4C404D52C36F4C",
  SGOV: "0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5",
  SHOP: "0xF53F66751B1Eff985311b693531E3290F600c410",
  SLV: "0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f",
  SMCI: "0xc01aA1fECeC0605b13bc84874ff7256C0f5F562a",
  SMH: "0x072f979c2CAc8e1391B0162a87Fee094bF8744a0",
  SOFI: "0x98E75885157C80992A8D41b696D8c9C6Fb30A926",
  SPCX: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa",
  SPY: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C",
  TSLA: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
  TSM: "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA",
  UPS: "0xf23250dac154D05Bb671CB0d0eBEf3c635c79CE2",
  USDG: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  USO: "0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344",
  VTI: "0x0594134DF3f171a354D9C85eBD65b7A6148F6D09",
  XLK: "0x15Cd20759CE7F3285c29A319dE2D1A2e098c6f43",
};

export function getOperatorUrl(env?: unknown): string {
  if (env && typeof env === "object") {
    const e = env as Record<string, unknown>;
    for (const key of [
      "CURTAIN_API_URL",
      "CURTAIN_OPERATOR_URL",
      "OPERATOR_API_URL",
      "VITE_CURTAIN_API_URL",
    ]) {
      if (typeof e[key] === "string" && e[key]) return (e[key] as string).replace(/\/$/, "");
    }
  }
  if (typeof process !== "undefined" && process.env) {
    const p = process.env;
    for (const key of [
      "CURTAIN_API_URL",
      "CURTAIN_OPERATOR_URL",
      "OPERATOR_API_URL",
      "VITE_CURTAIN_API_URL",
    ]) {
      if (typeof p[key] === "string" && p[key]) return p[key]!.replace(/\/$/, "");
    }
  }
  return "https://operator.curtainrh.com";
}

function getVaultAddress(env?: unknown): string {
  if (env && typeof env === "object") {
    const e = env as Record<string, unknown>;
    if (typeof e["VITE_VAULT_ADDR"] === "string" && e["VITE_VAULT_ADDR"])
      return e["VITE_VAULT_ADDR"] as string;
    if (typeof e["VAULT_ADDR"] === "string" && e["VAULT_ADDR"]) return e["VAULT_ADDR"] as string;
  }
  if (typeof process !== "undefined" && process.env) {
    const p = process.env;
    if (p["VITE_VAULT_ADDR"]) return p["VITE_VAULT_ADDR"];
    if (p["VAULT_ADDR"]) return p["VAULT_ADDR"];
  }
  return "0xF9381841e982648c178E762116A437Ecbcf12Bbd";
}

export async function handleCurtainApiProxy(
  request: Request,
  env?: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  // Only match /api/curtain exactly or subpaths under /api/curtain/ (prevent /api/curtain.attacker.com)
  if (url.pathname !== "/api/curtain" && !url.pathname.startsWith("/api/curtain/")) {
    return null;
  }

  // Preflight CORS support
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    });
  }

  let subpath = url.pathname.slice("/api/curtain".length);
  if (!subpath || !subpath.startsWith("/")) {
    subpath = "/" + subpath;
  }
  const operatorUrl = getOperatorUrl(env);

  // If operator URL is configured, forward request to the backend operator
  if (operatorUrl) {
    let targetUrl: URL | null = null;
    try {
      const opBase = new URL(operatorUrl);
      const cleanBasePath = opBase.pathname.replace(/\/+$/, "");
      targetUrl = new URL(cleanBasePath + subpath + url.search, opBase.origin);
      // Strictly prevent origin escape / SSRF
      if (targetUrl.origin !== opBase.origin) {
        targetUrl = null;
      }
    } catch {
      targetUrl = null;
    }

    if (targetUrl) {
      try {
        const headers = new Headers();
        for (const [k, v] of request.headers.entries()) {
          const lower = k.toLowerCase();
          if (!["host", "connection", "content-length", "cookie", "authorization", "accept-encoding"].includes(lower)) {
            headers.set(k, v);
          }
        }
        const init: RequestInit = {
          method: request.method,
          headers,
          signal: AbortSignal.timeout(10000),
        };
        if (request.method !== "GET" && request.method !== "HEAD") {
          init.body = await request.arrayBuffer();
        }

        const upstream = await fetch(targetUrl.toString(), init);
        if (upstream.status >= 500 && (subpath === "/config" || subpath === "/health")) {
          throw new Error(`operator returned ${upstream.status}`);
        }
        const resHeaders = new Headers(upstream.headers);
        resHeaders.set("access-control-allow-origin", "*");
        // Strip compression & hop-by-hop headers: fetch() decompresses the body in memory
        resHeaders.delete("content-encoding");
        resHeaders.delete("content-length");
        resHeaders.delete("transfer-encoding");
        resHeaders.delete("connection");

        // Prevent reflected HTML / XSS on Curtain origin
        const cType = resHeaders.get("content-type") || "";
        if (cType.toLowerCase().includes("text/html") || cType.toLowerCase().includes("application/xhtml")) {
          return new Response(JSON.stringify({ error: "Disallowed upstream content type" }), {
            status: 502,
            headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
          });
        }

        const bodyData = await upstream.arrayBuffer();
        return new Response(bodyData, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: resHeaders,
        });
      } catch (err) {
        console.warn(`Upstream operator request to ${targetUrl.toString()} failed:`, err);
      }
    }
  }

  // Graceful offline fallbacks when backend operator is not yet running
  if (subpath === "/health") {
    return new Response(
      JSON.stringify({
        status: "ok",
        operator: "offline",
        message: "Curtain operator pending deployment",
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
        },
      },
    );
  }

  if (subpath === "/config") {
    const vault = getVaultAddress(env);
    if (vault) {
      return new Response(
        JSON.stringify({
          vault,
          tokens: DEFAULT_TOKENS,
          keeperFeeBps: 5,
          maxDelaySeconds: 15552000,
          offline: true,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "access-control-allow-origin": "*",
          },
        },
      );
    }
    return new Response(
      JSON.stringify({
        error: "Curtain operator backend is offline or awaiting mainnet deployment.",
        status: "pending_deployment",
      }),
      {
        status: 503,
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
        },
      },
    );
  }

  return new Response(
    JSON.stringify({
      error: "Curtain operator backend is not reachable. Swaps are currently paused.",
      code: "OPERATOR_OFFLINE",
    }),
    {
      status: 503,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      },
    },
  );
}

export async function handleAssetProxy(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/__l5e/")) {
    return null;
  }
  const remoteUrl = `https://curtainlah.lovable.app${url.pathname}${url.search}`;
  try {
    const upstream = await fetch(remoteUrl, { signal: AbortSignal.timeout(10000) });
    const headers = new Headers(upstream.headers);
    headers.set("cache-control", "public, max-age=31536000, immutable");
    headers.set("access-control-allow-origin", "*");
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch {
    return null;
  }
}
