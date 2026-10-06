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
 */
import { getAddress, isAddress, type Address } from "viem";
import type { Db } from "@curtain/db";
import { createIntent, IntentError, MAX_DELAY_SECONDS, MAX_SPLITS, minSplitShareBps } from "./intents";
import type { Operator } from "./operator";

export interface ApiConfig {
  db: Db;
  operator: Operator;
  vault: Address;
  tokens: Record<string, Address>; // symbol -> address
  keeperFeeBps: number;
  /** /status reports a problem below this operator gas balance (default 0.005 ETH). */
  minBalanceWei?: bigint;
  now?: () => number; // unix seconds
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });

export function createApi(cfg: ApiConfig): (req: Request) => Promise<Response> {
  const now = cfg.now ?? (() => Math.floor(Date.now() / 1000));
  const allowed = new Set(Object.values(cfg.tokens).map((t) => getAddress(t))); // config casing must not matter

  return async (req) => {
    const url = new URL(req.url);
    const pathname = url.pathname.replace(/\/+/g, "/");
    try {
      if (req.method === "OPTIONS") {
        return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type" } });
      }
      if (req.method === "GET" && pathname === "/health") return json({ status: "ok" });

      // For an uptime monitor: 503 with the list of problems when something needs attention.
      if (req.method === "GET" && pathname === "/status") {
        const st = await cfg.operator.status(now(), { minBalanceWei: cfg.minBalanceWei });
        return json(st, st.ok ? 200 : 503);
      }

      if (req.method === "GET" && pathname === "/config") {
        const stealth = cfg.operator.stealthInfo;
        const split = cfg.operator.splitInfo;
        return json({
          vault: cfg.vault, tokens: cfg.tokens, keeperFeeBps: cfg.keeperFeeBps, maxDelaySeconds: MAX_DELAY_SECONDS,
          ...(stealth ? { stealth } : {}), ...(split ? { split } : {}),
        });
      }

      if (req.method === "GET" && pathname === "/quote") {
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
          if (!cfg.operator.stealthEnabled) return json({ error: "stealth payouts are not enabled" }, 400);
          const fee = await cfg.operator.stealthFee(getAddress(tokenOut));
          if (fee === null) return json({ error: "private address delivery isn't available for this token yet" }, 400);
          stealthFee = fee;
        }
        let split: { parts: number; minShareBps: number } | undefined;
        const splitsParam = url.searchParams.get("splits");
        if (splitsParam !== null) {
          if (!cfg.operator.splitEnabled) return json({ error: "split payouts are not enabled" }, 400);
          const parts = Number(splitsParam);
          const mode = url.searchParams.get("splitMode") ?? "random";
          if (!Number.isInteger(parts) || parts < 2 || parts > MAX_SPLITS) return json({ error: `a split needs 2 to ${MAX_SPLITS} recipients` }, 400);
          if (mode !== "random" && mode !== "equal") return json({ error: "splitMode must be random or equal" }, 400);
          split = { parts, minShareBps: minSplitShareBps(parts, mode) };
        }
        return json(await cfg.operator.quoteForUser(getAddress(tokenIn), getAddress(tokenOut), BigInt(amountIn), slippage, stealthFee, split));
      }

      if (req.method === "POST" && pathname === "/intents") {
        const body = (await req.json()) as Record<string, unknown>;
        const asStealth = (v: unknown) => {
          const st = v as Record<string, unknown>;
          return { ephemeralPublicKey: String(st["ephemeralPublicKey"]), viewTag: String(st["viewTag"]) };
        };
        let stealth: { ephemeralPublicKey: string; viewTag: string } | undefined;
        let splits: { recipient: string; stealth?: { ephemeralPublicKey: string; viewTag: string } }[] | undefined;
        if (body["splits"] !== undefined && body["splits"] !== null) {
          if (!cfg.operator.splitEnabled) return json({ error: "split payouts are not enabled" }, 400);
          if (!Array.isArray(body["splits"])) return json({ error: "splits must be a list" }, 400);
          splits = (body["splits"] as unknown[]).map((raw) => {
            const sp = (raw ?? {}) as Record<string, unknown>;
            return { recipient: String(sp["recipient"]), ...(sp["stealth"] ? { stealth: asStealth(sp["stealth"]) } : {}) };
          });
        }
        if (body["stealth"] !== undefined && body["stealth"] !== null) stealth = asStealth(body["stealth"]);
        let stealthFee: bigint | undefined;
        if (stealth || splits?.some((sp) => sp.stealth)) {
          if (!cfg.operator.stealthEnabled) return json({ error: "stealth payouts are not enabled" }, 400);
          const tokenOut = String(body["tokenOut"]);
          const fee = isAddress(tokenOut) ? await cfg.operator.stealthFee(getAddress(tokenOut)) : null;
          if (fee === null) return json({ error: "private address delivery isn't available for this token yet" }, 400);
          stealthFee = fee;
        }
        const intent = await createIntent(cfg.db, {
          tokenIn: String(body["tokenIn"]),
          amountIn: String(body["amountIn"]),
          tokenOut: String(body["tokenOut"]),
          recipient: String(body["recipient"]),
          depositor: String(body["depositor"]),
          minOut: String(body["minOut"]),
          delaySeconds: Number(body["delaySeconds"] ?? 0),
          ...(stealth ? { stealth } : {}),
          ...(stealthFee !== undefined ? { stealthFee } : {}),
          ...(splits ? { splits, splitMode: body["splitMode"] === "equal" ? "equal" : "random" } : {}),
        }, allowed, cfg.vault, now());
        return json({
          id: intent.id, deadline: intent.deadline, salt: intent.salt, deadlineHash: intent.deadlineHash, vault: cfg.vault,
          ...(intent.splits ? { splits: intent.splits } : {}),
        }, 201);
      }

      const m = pathname.match(/^\/intents\/([0-9a-f]{32})$/);
      if (req.method === "GET" && m) {
        const rows = await cfg.db.query<Record<string, unknown>>(
          `SELECT i.status, i.deposit_id::text AS "depositId", i.amount_out::text AS "amountOut", s.tx_hash AS "payoutTx",
                  i.blocked_reason AS "blockedReason"
           FROM intents i LEFT JOIN settlements s ON s.id = i.settlement_id AND s.status = 'confirmed' WHERE i.id = $1`,
          [m[1]],
        );
        return rows[0] ? json(rows[0]) : json({ error: "unknown intent" }, 404);
      }

      if (req.method === "GET" && pathname === "/settlements/pending") {
        return json(await cfg.operator.pendingSettlements(now()));
      }

      return json({ error: "not found" }, 404);
    } catch (e) {
      if (e instanceof IntentError || e instanceof SyntaxError) return json({ error: e.message }, 400);
      console.error(e);
      return json({ error: "internal error" }, 500);
    }
  };
}
