/**
 * Operator HTTP API.
 *
 *   GET  /health                  liveness (always 200 while the process serves)
 *   GET  /status                  200 when healthy, 503 + problems when it needs attention
 *   GET  /config                  vault, tokens, fees, limits
 *   GET  /quote?tokenIn&tokenOut&amountIn[&slippageBps][&stealth=1]   expected output after fees, suggested minOut
 *   POST /intents                 { tokenIn, amountIn, tokenOut, recipient, depositor, minOut, delaySeconds,
 *                                   stealth?: { ephemeralPublicKey, viewTag },      (FEATURE_STEALTH_PAYOUTS)
 *                                   splits?: [{ recipient, stealth? }], splitMode? } (FEATURE_SPLIT_PAYOUTS)
 *   GET  /quote ... [&splits=2..5&splitMode=random|equal]
 *                                 -> { id, deadline, salt, deadlineHash, vault }
 *                                 Keep `deadline` and `salt`: they unlock the escape hatch.
 *   GET  /intents/:id             status of your swap
 *   GET  /settlements/pending     signed settlements any keeper may submit (keeper earns the fees)
 *   GET  /keeper/v1/settlements/pending?privacyRoute=v2|v3
 *                                public, versioned keeper feed with vault metadata
 *   GET  /pool                    deposits waiting to be paid, per input token (FEATURE_ANONYMITY_SET)
 *   GET  /sync/:id                an encrypted escape-ticket backup (FEATURE_TICKET_SYNC)
 *   PUT  /sync/:id                { authKey, blob }: store it; the first write pins keccak256(authKey)
 */
import { getAddress, isAddress, keccak256, type Address, type Hex } from "viem";
import type { Db } from "@curtain/db";
import { createIntent, IntentError, MAX_DELAY_SECONDS, MAX_SPLITS, minSplitShareBps } from "./intents";
import type { Operator } from "./operator";
import { createDeveloperApi } from "./developer";
import type { PoolV2RootPublisher } from "./poolV2";

export interface ApiConfig {
  chainId?: number;
  db: Db;
  operator: Operator;
  vault: Address;
  tokens: Record<string, Address>; // symbol -> address
  keeperFeeBps: number;
  /** /status reports a problem below this operator gas balance (default 0.005 ETH). */
  minBalanceWei?: bigint;
  now?: () => number; // unix seconds
  v3Mode?: boolean;
  fixedAmounts?: Set<string>;
  poolV4?: { publisher: PoolV2RootPublisher; pool: Address; rootManager: Address };
  poolV4Legacy?: { publisher: PoolV2RootPublisher; pool: Address; rootManager: Address }[];
  contexts?: { v2: Omit<ApiConfig, "contexts">; v3?: Omit<ApiConfig, "contexts"> };
}

/** Largest ticket-sync request accepted: about 200 KB of encrypted tickets plus JSON overhead. */
export const MAX_SYNC_BODY = 420_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });

/** In-memory rate limiting map (IP -> request bucket). */
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function checkRate(key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  if (rateBuckets.size > 10_000) {
    for (const [k, v] of rateBuckets) {
      if (now > v.resetAt) rateBuckets.delete(k);
    }
  }
  const entry = rateBuckets.get(key);
  if (!entry || now > entry.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

export function createApi(cfg: ApiConfig): (req: Request) => Promise<Response> {
  const now = cfg.now ?? (() => Math.floor(Date.now() / 1000));
  const developerApi = createDeveloperApi(cfg);

  return async (req) => {
    const developerResponse = await developerApi(req);
    if (developerResponse) return developerResponse;
    const version = req.headers.get("x-curtain-version")?.trim().toLowerCase() === "v3" ? "v3" : "v2";
    const active = cfg.contexts?.[version] ?? cfg;
    const allowed = new Set(Object.values(active.tokens).map((t) => getAddress(t))); // config casing must not matter
    const url = new URL(req.url);
    const pathname = url.pathname.replace(/\/+/g, "/");
    const clientIp = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "ip:default";

    try {
      if (req.method === "OPTIONS") {
        return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, PUT", "access-control-allow-headers": "content-type" } });
      }
      if (req.method === "GET" && pathname === "/health") return json({ status: "ok" });

      // For an uptime monitor: 503 with the list of problems when something needs attention.
      if (req.method === "GET" && pathname === "/status") {
        const st = await active.operator.status(now(), { minBalanceWei: active.minBalanceWei });
        return json(st, st.ok ? 200 : 503);
      }

      if (req.method === "GET" && pathname === "/config") {
        const stealth = active.operator.stealthInfo;
        const split = active.operator.splitInfo;
        return json({
          vault: active.vault, tokens: active.tokens, keeperFeeBps: active.keeperFeeBps, maxDelaySeconds: MAX_DELAY_SECONDS,
          ...(stealth ? { stealth } : {}), ...(split ? { split } : {}),
          ...(active.operator.anonymitySetEnabled ? { pool: { enabled: true } } : {}),
          ...(cfg.operator.ticketSyncEnabled ? { sync: { enabled: true } } : {}),
          ...(active.poolV4 ? { poolV4: { enabled: true, pool: active.poolV4.pool, rootManager: active.poolV4.rootManager } } : {}),
        });
      }

      if (req.method === "GET" && pathname.startsWith("/pool-v4/witness/")) {
        const commitment = pathname.slice("/pool-v4/witness/".length);
        if (!/^0x[\da-f]{64}$/i.test(commitment)) return json({ error: "commitment must be a bytes32 hex value" }, 400);
        for (const pool of [...(active.poolV4 ? [active.poolV4] : []), ...(active.poolV4Legacy ?? [])]) {
          const witness = await pool.publisher.witness(commitment as `0x${string}`);
          if (witness) return json({ ...witness, pool: pool.pool });
        }
        return json({ error: "note not found" }, 404);
      }

      if (req.method === "GET" && pathname === "/pool-v4/quote") {
        if (!active.poolV4) return json({ error: "V4 pool is not enabled" }, 404);
        const tokenIn = url.searchParams.get("tokenIn") ?? "";
        const tokenOut = url.searchParams.get("tokenOut") ?? "";
        const amountIn = url.searchParams.get("amountIn") ?? "";
        if (!isAddress(tokenIn) || !isAddress(tokenOut) || !/^[1-9]\d*$/.test(amountIn))
          return json({ error: "tokenIn, tokenOut (addresses) and amountIn (raw units, > 0) are required" }, 400);
        if (!allowed.has(getAddress(tokenIn)) || !allowed.has(getAddress(tokenOut))) return json({ error: "token not supported" }, 400);
        const slippage = Number(url.searchParams.get("slippageBps") ?? 100);
        if (!Number.isInteger(slippage) || slippage < 0 || slippage > 5000) return json({ error: "slippageBps must be 0..5000" }, 400);
        return json({ pool: active.poolV4.pool, ...await active.operator.quoteForPool(active.poolV4.pool, getAddress(tokenIn), getAddress(tokenOut), BigInt(amountIn), slippage) });
      }

      if (req.method === "GET" && pathname === "/quote") {
        if (!checkRate(`quote:${clientIp}`, 120)) {
          return json({ error: "Too many quote requests. Please wait a moment." }, 429);
        }
        const tokenIn = url.searchParams.get("tokenIn") ?? "";
        const tokenOut = url.searchParams.get("tokenOut") ?? "";
        const amountIn = url.searchParams.get("amountIn") ?? "";
        if (!isAddress(tokenIn) || !isAddress(tokenOut) || !/^[1-9]\d*$/.test(amountIn)) {
          return json({ error: "tokenIn, tokenOut (addresses) and amountIn (raw units, > 0) are required" }, 400);
        }
        if (!allowed.has(getAddress(tokenIn)) || !allowed.has(getAddress(tokenOut))) return json({ error: "token not supported" }, 400);
        const slippage = Number(url.searchParams.get("slippageBps") ?? 100);
        if (!(slippage >= 0 && slippage <= 5000)) return json({ error: "slippageBps must be 0..5000" }, 400);
        let stealthFee: bigint | undefined;
        if (url.searchParams.get("stealth") === "1") {
          if (!active.operator.stealthEnabled) return json({ error: "stealth payouts are not enabled" }, 400);
          const fee = await active.operator.stealthFee(getAddress(tokenOut));
          if (fee === null) return json({ error: "private address delivery isn't available for this token yet" }, 400);
          stealthFee = fee;
        }
        let split: { parts: number; minShareBps: number } | undefined;
        const splitsParam = url.searchParams.get("splits");
        if (splitsParam !== null) {
          if (!active.operator.splitEnabled) return json({ error: "split payouts are not enabled" }, 400);
          const parts = Number(splitsParam);
          const mode = url.searchParams.get("splitMode") ?? "random";
          if (!Number.isInteger(parts) || parts < 2 || parts > MAX_SPLITS) return json({ error: `a split needs 2 to ${MAX_SPLITS} recipients` }, 400);
          if (mode !== "random" && mode !== "equal") return json({ error: "splitMode must be random or equal" }, 400);
          split = { parts, minShareBps: minSplitShareBps(parts, mode) };
        }
        return json(await active.operator.quoteForUser(getAddress(tokenIn), getAddress(tokenOut), BigInt(amountIn), slippage, stealthFee, split));
      }

      if (req.method === "POST" && pathname === "/intents") {
        if (!checkRate(`intent:${clientIp}`, 30)) {
          return json({ error: "Too many intent submissions. Please wait a moment." }, 429);
        }
        const cl = Number(req.headers.get("content-length") ?? 0);
        if (cl > 32_768) {
          return json({ error: "Payload too large (max 32KB)" }, 413);
        }
        const body = (await req.json()) as Record<string, unknown>;
        if (body["orderType"] !== undefined && body["orderType"] !== "market" && body["orderType"] !== "limit")
          return json({ error: "orderType must be market or limit" }, 400);
        const asStealth = (v: unknown) => {
          const st = v as Record<string, unknown>;
          return { ephemeralPublicKey: String(st["ephemeralPublicKey"]), viewTag: String(st["viewTag"]) };
        };
        let stealth: { ephemeralPublicKey: string; viewTag: string } | undefined;
        let splits: { recipient: string; stealth?: { ephemeralPublicKey: string; viewTag: string } }[] | undefined;
        if (body["splits"] !== undefined && body["splits"] !== null) {
          if (!active.operator.splitEnabled) return json({ error: "split payouts are not enabled" }, 400);
          if (!Array.isArray(body["splits"])) return json({ error: "splits must be a list" }, 400);
          splits = (body["splits"] as unknown[]).map((raw) => {
            const sp = (raw ?? {}) as Record<string, unknown>;
            return { recipient: String(sp["recipient"]), ...(sp["stealth"] ? { stealth: asStealth(sp["stealth"]) } : {}) };
          });
        }
        if (body["stealth"] !== undefined && body["stealth"] !== null) stealth = asStealth(body["stealth"]);
        let stealthFee: bigint | undefined;
        if (stealth || splits?.some((sp) => sp.stealth)) {
          if (!active.operator.stealthEnabled) return json({ error: "stealth payouts are not enabled" }, 400);
          const tokenOut = String(body["tokenOut"]);
          const fee = isAddress(tokenOut) ? await active.operator.stealthFee(getAddress(tokenOut)) : null;
          if (fee === null) return json({ error: "private address delivery isn't available for this token yet" }, 400);
          stealthFee = fee;
        }
        const intent = await createIntent(active.db, {
          tokenIn: String(body["tokenIn"]),
          amountIn: String(body["amountIn"]),
          tokenOut: String(body["tokenOut"]),
          recipient: String(body["recipient"]),
          depositor: String(body["depositor"]),
          minOut: String(body["minOut"]),
          delaySeconds: Number(body["delaySeconds"] ?? 0),
          orderType: body["orderType"] === "limit" ? "limit" : "market",
          ...(body["expiresInSeconds"] !== undefined ? { expiresInSeconds: Number(body["expiresInSeconds"]) } : {}),
          ...(stealth ? { stealth } : {}),
          ...(stealthFee !== undefined ? { stealthFee } : {}),
          ...(splits ? { splits, splitMode: body["splitMode"] === "equal" ? "equal" : "random" } : {}),
        }, allowed, active.vault, now(), active.v3Mode === true, active.fixedAmounts);
        return json({
          id: intent.id, deadline: intent.deadline, salt: intent.salt, deadlineHash: intent.deadlineHash, vault: active.vault, ...(intent.tag ? { tag: intent.tag } : {}),
          ...(intent.splits ? { splits: intent.splits } : {}),
        }, 201);
      }

      const m = pathname.match(/^\/intents\/([0-9a-f]{32})$/);
      if (req.method === "GET" && m) {
        const rows = await active.db.query<Record<string, unknown>>(
          `SELECT i.status, i.order_type AS "orderType", i.deadline::text AS deadline, i.deposit_id::text AS "depositId", i.amount_out::text AS "amountOut", s.tx_hash AS "payoutTx",
                  i.blocked_reason AS "blockedReason"
           FROM intents i LEFT JOIN settlements s ON s.id = i.settlement_id AND s.status = 'confirmed' WHERE i.id = $1
           AND NOT EXISTS (SELECT 1 FROM developer_intents d WHERE d.intent_id = i.id)
           AND NOT EXISTS (SELECT 1 FROM developer_v3_intents d WHERE d.intent_id = i.id)`,
          [m[1]],
        );
        return rows[0] ? json(rows[0]) : json({ error: "unknown intent" }, 404);
      }

      // Encrypted ticket backups. Always the main (V2) database, whatever context was asked for:
      // a backup belongs to a wallet, not to a vault version. The operator only ever sees an id
      // and an opaque blob, both derived in the browser from a wallet signature.
      const syncMatch = pathname.match(/^\/sync\/(0x[0-9a-fA-F]{64})$/);
      if (syncMatch) {
        if (!cfg.operator.ticketSyncEnabled) return json({ error: "not found" }, 404);
        const id = syncMatch[1]!.toLowerCase();
        if (req.method === "GET") {
          if (!checkRate(`sync-get:${clientIp}`, 60)) return json({ error: "Too many requests. Please wait a moment." }, 429);
          const rows = await cfg.db.query<{ blob: string; updated_at: Date }>("SELECT blob, updated_at FROM ticket_sync WHERE id = $1", [id]);
          return rows[0] ? json({ blob: rows[0].blob, updatedAt: new Date(rows[0].updated_at).toISOString() }) : json({ error: "no backup" }, 404);
        }
        if (req.method === "PUT") {
          if (!checkRate(`sync-put:${clientIp}`, 30)) return json({ error: "Too many backups. Please wait a moment." }, 429);
          if (Number(req.headers.get("content-length") ?? 0) > MAX_SYNC_BODY) return json({ error: "Backup too large" }, 413);
          const text = await req.text();
          if (text.length > MAX_SYNC_BODY) return json({ error: "Backup too large" }, 413);
          const body = JSON.parse(text) as Record<string, unknown>;
          const authKey = String(body["authKey"] ?? "");
          const blob = String(body["blob"] ?? "");
          if (!/^0x[0-9a-fA-F]{64}$/.test(authKey)) return json({ error: "authKey must be 32 bytes" }, 400);
          // At least a 12-byte IV and a 16-byte GCM tag.
          if (!/^0x(?:[0-9a-fA-F]{2}){28,}$/.test(blob)) return json({ error: "blob must be encrypted bytes" }, 400);
          const authHash = keccak256(authKey.toLowerCase() as Hex);
          const stored = await cfg.db.transaction(async (tx) => {
            const existing = await tx.query<{ auth_hash: string }>("SELECT auth_hash FROM ticket_sync WHERE id = $1 FOR UPDATE", [id]);
            if (existing[0] && existing[0].auth_hash !== authHash) return false;
            await tx.query(
              `INSERT INTO ticket_sync (id, auth_hash, blob) VALUES ($1, $2, $3)
               ON CONFLICT (id) DO UPDATE SET blob = EXCLUDED.blob, updated_at = now()`,
              [id, authHash, blob.toLowerCase()],
            );
            return true;
          });
          return stored ? json({ ok: true }) : json({ error: "This backup belongs to different keys." }, 403);
        }
        return json({ error: "method not allowed" }, 405);
      }

      if (req.method === "GET" && pathname === "/pool") {
        if (!active.operator.anonymitySetEnabled) return json({ error: "not found" }, 404);
        return json(await active.operator.waitingDeposits());
      }

      if (req.method === "GET" && (pathname === "/settlements/pending" || pathname === "/keeper/v1/settlements/pending")) {
        const routeParam = url.searchParams.get("privacyRoute");
        if (routeParam !== null && routeParam !== "v2" && routeParam !== "v3") {
          return json({ error: 'privacyRoute must be "v2" or "v3"' }, 400);
        }
        const route = routeParam === "v3" ? "v3" : routeParam === "v2" ? "v2" : version;
        if (pathname === "/keeper/v1/settlements/pending" && !checkRate(`keeper:${route}:${clientIp}`, 60)) {
          return json({ error: "Too many keeper feed requests. Please wait a moment." }, 429);
        }
        const keeperContext = cfg.contexts?.[route] ?? (route === "v2" ? cfg : undefined);
        if (!keeperContext) return json({ error: "V3 operator context is not configured" }, 503);
        const settlements = await keeperContext.operator.pendingSettlements(now());
        if (pathname === "/settlements/pending") return json(settlements);
        return json({
          chainId: cfg.chainId ?? 4663,
          privacyRoute: route,
          vault: keeperContext.vault,
          settlements,
        });
      }

      return json({ error: "not found" }, 404);
    } catch (e) {
      if (e instanceof IntentError || e instanceof SyntaxError) return json({ error: e.message }, 400);
      console.error(e);
      return json({ error: "internal error" }, 500);
    }
  };
}
