import { createHash, randomBytes } from "node:crypto";
import {
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  verifyMessage,
  type Address,
  type Hex,
} from "viem";
import { ERC20_ABI, VAULT_ABI } from "@curtain/sdk";
import type { Db } from "@curtain/db";
import type { ApiConfig } from "./api";
import { createIntent, IntentError, MAX_DELAY_SECONDS, MAX_INTEGRATOR_FEE_BPS } from "./intents";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const id = () => randomBytes(16).toString("hex");
const reply = (body: unknown, status = 200) =>
  new Response(
    JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    },
  );
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function bodyOf(req: Request): Promise<Record<string, unknown>> {
  // Enforce the limit on bytes actually read, including chunked requests.
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError(400, "JSON body required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16384) {
      await reader.cancel();
      throw new ApiError(413, "Request body exceeds 16 KB");
    }
    chunks.push(value);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new ApiError(400, "JSON object required");
  return parsed;
}
function tokenAddress(value: unknown, name: string): Address {
  if (typeof value !== "string" || !isAddress(value))
    throw new ApiError(400, `${name} must be an address`);
  return getAddress(value);
}
function units(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[1-9]\d{0,77}$/.test(value) || BigInt(value) >= 2n ** 256n)
    throw new ApiError(400, `${name} must be a positive uint256 decimal string in raw token units`);
  return value;
}
function integratorFee(value: unknown, vault: Address): { recipient: Address; bps: number } | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(400, "integratorFee must be an object");
  const raw = value as Record<string, unknown>;
  const recipient = tokenAddress(raw.recipient, "integratorFee.recipient");
  const bps = raw.bps;
  if (typeof bps !== "number" || !Number.isInteger(bps) || bps < 0 || bps > MAX_INTEGRATOR_FEE_BPS)
    throw new ApiError(400, `integratorFee.bps must be an integer from 0 to ${MAX_INTEGRATOR_FEE_BPS}`);
  if (BigInt(recipient) === 0n || recipient === getAddress(vault))
    throw new ApiError(400, "integratorFee.recipient can't be the zero address or the vault");
  return bps > 0 ? { recipient, bps } : undefined;
}
const keyFields =
  'id, name, prefix, created_at AS "createdAt", revoked_at AS "revokedAt", last_used_at AS "lastUsedAt"';

/** Authenticated developer API. V2, V3, and automatic route selection are supported. */
export function createDeveloperApi(root: ApiConfig) {
  const cfg = root.contexts?.v2 ?? root;
  const v3 = root.contexts?.v3;
  const db = root.db;
  const now = root.now ?? (() => Math.floor(Date.now() / 1000));
  const chainId = root.chainId ?? 4663;
  const allowed = new Set(Object.values(cfg.tokens).map((token) => getAddress(token)));
  const allowedV3 = v3 ? new Set(Object.values(v3.tokens).map((token) => getAddress(token))) : allowed;
  const fixedDenominationCache = v3?.fixedAmounts
    ? [...v3.fixedAmounts].map((entry) => {
        const [token, amount] = entry.split(":");
        return { token, amount };
      })
    : [];
  type Route = {
    context: ApiConfig;
    table: "developer_intents" | "developer_v3_intents";
    mode: "v2" | "v3";
    allowed: Set<Address>;
    reason: "explicit_v2" | "explicit_v3" | "approved_fixed_denomination" | "amount_not_in_v3_denomination_set";
  };
  const contextFor = (route: unknown, tokenIn?: Address, amount?: string): Route => {
    if (route === "v2") return { context: cfg, table: "developer_intents", mode: "v2" as const, allowed, reason: "explicit_v2" };
    if (route === "v3" && v3?.v3Mode)
      return { context: v3, table: "developer_v3_intents", mode: "v3" as const, allowed: allowedV3, reason: "explicit_v3" };
    if (route === "dynamic") {
      if (!tokenIn || !amount)
        throw new ApiError(400, "Dynamic privacy requires tokenIn and amountIn");
      if (v3?.v3Mode && v3.fixedAmounts?.has(`${tokenIn}:${amount}`))
        return { context: v3, table: "developer_v3_intents", mode: "v3", allowed: allowedV3, reason: "approved_fixed_denomination" };
      return { context: cfg, table: "developer_intents", mode: "v2", allowed, reason: "amount_not_in_v3_denomination_set" };
    }
    throw new ApiError(400, 'privacyRoute must be "v2", "v3", or "dynamic"');
  };
  const fixedDenominations = () => {
    return fixedDenominationCache;
  };
  const authBuckets = new Map<string, { start: number; count: number }>();
  let lastChallengeCleanup = 0;
  function throttleAuth(req: Request) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const minute = Math.floor(now() / 60);
    if (authBuckets.size > 10000) {
      for (const [key, entry] of authBuckets) if (entry.start !== minute) authBuckets.delete(key);
      if (authBuckets.size > 10000) throw new ApiError(429, "Please retry later");
    }
    const entry = authBuckets.get(ip);
    if (entry?.start === minute) {
      if (++entry.count > 60) throw new ApiError(429, "Too many authentication requests");
    } else authBuckets.set(ip, { start: minute, count: 1 });
  }
  async function authenticate(req: Request): Promise<string> {
    const credential = req.headers
      .get("authorization")
      ?.match(/^Bearer (ctn_live_[A-Za-z0-9_-]{43})$/)?.[1];
    if (!credential) throw new ApiError(401, "Valid Bearer API key required");
    const rows = await db.query<{ id: string; request_count: number }>(
      `UPDATE developer_keys SET last_used_at = now(), window_start = $2,
       request_count = CASE WHEN window_start = $2 THEN request_count + 1 ELSE 1 END
       WHERE key_hash = $1 AND revoked_at IS NULL RETURNING id, request_count`,
      [hash(credential), Math.floor(now() / 60)],
    );
    if (!rows[0]) throw new ApiError(401, "Invalid or revoked API key");
    if (rows[0].request_count > 60)
      throw new ApiError(429, "API key limit: 60 requests per minute");
    return rows[0].id;
  }
  async function challenge(req: Request) {
    const body = await bodyOf(req);
    const wallet = tokenAddress(body.wallet, "wallet");
    const action = String(body.action);
    if (!["list", "create", "revoke"].includes(action))
      throw new ApiError(400, "Unknown key action");
    const payload =
      action === "create"
        ? { name: String(body.name ?? "").trim() }
        : action === "revoke"
          ? { keyId: String(body.keyId ?? "") }
          : {};
    if (action === "create" && (!payload.name || payload.name.length > 60))
      throw new ApiError(400, "Key name must be 1–60 characters");
    if (action === "revoke" && !/^[a-f0-9]{32}$/.test(payload.keyId!))
      throw new ApiError(400, "Invalid key ID");
    const nonce = id();
    const expires = new Date((now() + 300) * 1000);
    const message = [
      "Curtain Developer API — wallet authorization",
      "Domain: curtainrh.com",
      `Chain ID: ${chainId}`,
      `Wallet: ${wallet}`,
      `Action: ${action} API keys`,
      `Details: ${JSON.stringify(payload)}`,
      `Nonce: ${nonce}`,
      `Expires: ${expires.toISOString()}`,
      "This signature manages developer access. It does not transfer funds.",
    ].join("\n");
    if (now() - lastChallengeCleanup >= 60) {
      await db.query("DELETE FROM developer_challenges WHERE expires_at <= $1", [
        new Date(now() * 1000),
      ]);
      lastChallengeCleanup = now();
    }
    await db.transaction(async (tx) => {
      await tx.query("INSERT INTO developer_wallets(wallet) VALUES ($1) ON CONFLICT DO NOTHING", [
        wallet,
      ]);
      await tx.query("SELECT wallet FROM developer_wallets WHERE wallet = $1 FOR UPDATE", [wallet]);
      await tx.query("DELETE FROM developer_challenges WHERE wallet = $1 AND expires_at <= $2", [
        wallet,
        new Date(now() * 1000),
      ]);
      const count = await tx.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM developer_challenges WHERE wallet = $1",
        [wallet],
      );
      if (Number(count[0]?.n) >= 10)
        throw new ApiError(429, "Too many wallet challenges; retry in five minutes");
      await tx.query(
        "INSERT INTO developer_challenges(id,wallet,action,payload,message,expires_at) VALUES ($1,$2,$3,$4,$5,$6)",
        [nonce, wallet, action, JSON.stringify(payload), message, expires],
      );
    });
    return reply({ challengeId: nonce, message, expiresAt: expires.toISOString() });
  }
  async function manage(req: Request, action: string) {
    const body = await bodyOf(req);
    if (
      typeof body.challengeId !== "string" ||
      !/^[a-f0-9]{32}$/.test(body.challengeId) ||
      typeof body.signature !== "string" ||
      !/^0x[a-fA-F0-9]{130}$/.test(body.signature)
    )
      throw new ApiError(400, "Challenge ID and EOA wallet signature required");
    const rows = await db.query<{
      wallet: Address;
      action: string;
      payload: { name?: string; keyId?: string };
      message: string;
    }>(
      "SELECT wallet, action, payload, message FROM developer_challenges WHERE id = $1 AND used_at IS NULL AND expires_at > $2",
      [body.challengeId, new Date(now() * 1000)],
    );
    const proof = rows[0];
    if (!proof || proof.action !== action)
      throw new ApiError(401, "Challenge expired, used, or does not match this action");
    let valid = false;
    try {
      valid = await verifyMessage({
        address: proof.wallet,
        message: proof.message,
        signature: body.signature as Hex,
      });
    } catch {
      /* Invalid signature. */
    }
    if (!valid) throw new ApiError(401, "Wallet signature does not match");
    return db.transaction(async (tx) => {
      const consumed = await tx.query(
        "UPDATE developer_challenges SET used_at = now() WHERE id = $1 AND used_at IS NULL AND expires_at > $2 RETURNING id",
        [body.challengeId, new Date(now() * 1000)],
      );
      if (!consumed.length) throw new ApiError(401, "Challenge already used or expired");
      await tx.query("SELECT wallet FROM developer_wallets WHERE wallet = $1 FOR UPDATE", [
        proof.wallet,
      ]);
      if (action === "list")
        return reply({
          keys: await tx.query(
            `SELECT ${keyFields} FROM developer_keys WHERE wallet = $1 ORDER BY created_at DESC`,
            [proof.wallet],
          ),
        });
      if (action === "revoke") {
        const revoked = await tx.query(
          "UPDATE developer_keys SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 AND wallet = $2 RETURNING id",
          [proof.payload.keyId, proof.wallet],
        );
        if (!revoked.length) throw new ApiError(404, "Key not found");
        return reply({ revoked: true });
      }
      const count = await tx.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM developer_keys WHERE wallet = $1 AND revoked_at IS NULL",
        [proof.wallet],
      );
      if (Number(count[0]?.n) >= 10) throw new ApiError(409, "Maximum 10 active keys per wallet");
      const secret = `ctn_live_${randomBytes(32).toString("base64url")}`;
      const keys = await tx.query(
        `INSERT INTO developer_keys(id,wallet,name,prefix,key_hash) VALUES ($1,$2,$3,$4,$5) RETURNING ${keyFields}`,
        [id(), proof.wallet, proof.payload.name, secret.slice(0, 16), hash(secret)],
      );
      return reply({ key: keys[0], apiKey: secret }, 201);
    });
  }
  function prepare(
    intent: {
      id: string;
      deadline: string | bigint;
      salt: string;
      deadlineHash: string;
      tag?: string;
    },
    params: { tokenIn: Address; amountIn: string; depositor: Address },
    context: ApiConfig,
    mode: "v2" | "v3",
    requestedPrivacyRoute: "v2" | "v3" | "dynamic",
    routeReason: Route["reason"],
  ) {
    const tx = (to: Address, data: Hex) => ({
      chainId,
      from: params.depositor,
      to,
      data,
      value: "0",
    });
    return {
      id: intent.id,
      requestedPrivacyRoute,
      privacyRoute: mode,
      routeReason,
      chainId,
      vault: context.vault,
      escapeTicket: {
        vault: context.vault,
        deadline: String(intent.deadline),
        salt: intent.salt,
        deadlineHash: intent.deadlineHash,
        ...(intent.tag ? { tag: intent.tag } : {}),
      },
      transactions: {
        approval: tx(
          params.tokenIn,
          encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [context.vault, BigInt(params.amountIn)],
          }),
        ),
        deposit: tx(
          context.vault,
          encodeFunctionData({
            abi: VAULT_ABI,
            functionName: "deposit",
            args: [params.tokenIn, BigInt(params.amountIn), intent.deadlineHash as Hex],
          }),
        ),
      },
    };
  }
  async function newIntent(req: Request, keyId: string) {
    const body = await bodyOf(req);
    if (body.stealth !== undefined || body.splits !== undefined)
      throw new ApiError(400, "This API currently supports single-recipient intents only");
    if (body.orderType !== undefined && body.orderType !== "market" && body.orderType !== "limit")
      throw new ApiError(400, "orderType must be market or limit");
    const params = {
      tokenIn: tokenAddress(body.tokenIn, "tokenIn"),
      tokenOut: tokenAddress(body.tokenOut, "tokenOut"),
      depositor: tokenAddress(body.depositor, "depositor"),
      recipient: tokenAddress(body.recipient, "recipient"),
      amountIn: units(body.amountIn, "amountIn"),
      minOut: units(body.minOut, "minOut"),
      delaySeconds: body.delaySeconds ?? 0,
      orderType: body.orderType === "limit" ? ("limit" as const) : ("market" as const),
      ...(body.expiresInSeconds !== undefined ? { expiresInSeconds: Number(body.expiresInSeconds) } : {}),
    };
    const requestedPrivacyRoute = body.privacyRoute;
    const route = contextFor(requestedPrivacyRoute, params.tokenIn, params.amountIn);
    const fee = integratorFee(body.integratorFee, route.context.vault);
    if (
      typeof params.delaySeconds !== "number" ||
      !Number.isInteger(params.delaySeconds) ||
      params.delaySeconds < 0 ||
      params.delaySeconds > MAX_DELAY_SECONDS
    )
      throw new ApiError(400, `delaySeconds must be an integer from 0 to ${MAX_DELAY_SECONDS}`);
    const normalized = { ...params, delaySeconds: params.delaySeconds as number, ...(fee ? { integratorFee: fee } : {}) };
    const requestId = req.headers.get("idempotency-key");
    if (!requestId || !/^[A-Za-z0-9_.:-]{1,128}$/.test(requestId))
      throw new ApiError(
        400,
        "Idempotency-Key header required (1–128 letters, numbers, _, ., :, -)",
      );
    const requestHash = hash(JSON.stringify(normalized));
    if (route.mode === "v2" && !route.context.db)
      throw new ApiError(503, "V2 operator context is not configured");
    return route.context.db.transaction(async (tx: Db) => {
      // Serialize creation/revocation per key and make ownership + idempotency atomic with the intent.
      if (route.mode === "v2") {
        const keys = await tx.query(
          "SELECT id FROM developer_keys WHERE id = $1 AND revoked_at IS NULL FOR UPDATE",
          [keyId],
        );
        if (!keys.length) throw new ApiError(401, "API key revoked");
      }
      const existing = await tx.query<{
        id: string;
        deadline: string;
        salt: string;
        deadlineHash: string;
        secret: string;
        request_hash: string;
      }>(
        `SELECT i.id, i.deadline::text, i.salt, i.deadline_hash AS "deadlineHash", i.secret, d.request_hash
         FROM ${route.table} d JOIN intents i ON i.id = d.intent_id WHERE d.key_id = $1 AND d.request_id = $2`,
        [keyId, requestId],
      );
      if (existing[0]) {
        if (existing[0].request_hash !== requestHash)
          throw new ApiError(409, "Idempotency-Key was already used with different parameters");
        return reply(
          prepare(
            {
              ...existing[0],
              ...(route.mode === "v3" ? { tag: keccak256(existing[0].secret as Hex) } : {}),
            },
            params,
            route.context,
            route.mode,
            requestedPrivacyRoute as "v2" | "v3" | "dynamic",
            route.reason,
          ),
        );
      }
      const intent = await createIntent(
        tx,
        normalized,
        route.allowed,
        route.context.vault,
        now(),
        route.mode === "v3",
        route.context.fixedAmounts,
      );
      await tx.query(
        `INSERT INTO ${route.table}(key_id,request_id,request_hash,intent_id) VALUES ($1,$2,$3,$4)`,
        [keyId, requestId, requestHash, intent.id],
      );
      return reply(
        prepare(
          intent,
          params,
          route.context,
          route.mode,
          requestedPrivacyRoute as "v2" | "v3" | "dynamic",
          route.reason,
        ),
        201,
      );
    });
  }
  return async (req: Request): Promise<Response | null> => {
    const url = new URL(req.url);
    const path = url.pathname;
    if (!path.startsWith("/developer/") && !path.startsWith("/v1/")) return null;
    try {
      if (req.method === "OPTIONS")
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "content-type, authorization, idempotency-key",
          },
        });
      if (path.startsWith("/developer/")) {
        throttleAuth(req);
        if (req.method !== "POST")
          throw new ApiError(405, "Use POST for wallet-authorized key management");
        if (path === "/developer/challenge") return await challenge(req);
        const action = path.match(/^\/developer\/keys\/(list|create|revoke)$/)?.[1];
        if (action) return await manage(req, action);
        throw new ApiError(404, "Not found");
      }
      const keyId = await authenticate(req);
      if (path === "/v1/config" && req.method === "GET")
        return reply({
          chainId,
          privacyRoutes: ["v2", ...(v3?.v3Mode ? ["v3", "dynamic"] : [])],
          vault: cfg.vault,
          vaults: { v2: cfg.vault, ...(v3?.v3Mode ? { v3: v3.vault } : {}) },
          tokens: cfg.tokens,
          maxDelaySeconds: MAX_DELAY_SECONDS,
          rateLimitPerMinute: 60,
          ...(v3?.v3Mode ? { v3FixedAmounts: fixedDenominations() } : {}),
          privacyPolicy: {
            dynamic: {
              priority: ["v3", "v2"],
              fallback: "v2",
              rule: "Use V3 for approved fixed denominations; otherwise use V2.",
            },
          },
        });
      if (path === "/v1/quote" && req.method === "GET") {
        const tokenIn = tokenAddress(url.searchParams.get("tokenIn"), "tokenIn");
        const tokenOut = tokenAddress(url.searchParams.get("tokenOut"), "tokenOut");
        const amount = units(url.searchParams.get("amountIn"), "amountIn");
        const requestedPrivacyRoute = url.searchParams.get("privacyRoute");
        const route = contextFor(requestedPrivacyRoute, tokenIn, amount);
        if (!route.allowed.has(tokenIn) || !route.allowed.has(tokenOut))
          throw new ApiError(400, "Token not supported");
        if (route.mode === "v3" && !route.context.fixedAmounts?.has(`${tokenIn}:${amount}`))
          throw new ApiError(400, "V3 only accepts an approved fixed denomination for this asset");
        const slippage = Number(url.searchParams.get("slippageBps") ?? 100);
        if (!Number.isInteger(slippage) || slippage < 0 || slippage > 5000)
          throw new ApiError(400, "slippageBps must be an integer from 0 to 5000");
        const feeBps = url.searchParams.get("integratorFeeBps");
        const feeRecipient = url.searchParams.get("integratorFeeRecipient");
        const fee = feeBps !== null || feeRecipient !== null
          ? integratorFee({ recipient: feeRecipient, bps: feeBps === null ? undefined : Number(feeBps) }, route.context.vault)
          : undefined;
        return reply({
          ...(await route.context.operator.quoteForUser(tokenIn, tokenOut, BigInt(amount), slippage, undefined, undefined, fee)),
          requestedPrivacyRoute,
          privacyRoute: route.mode,
          routeReason: route.reason,
        });
      }
      if (path === "/v1/intents" && req.method === "POST") return await newIntent(req, keyId);
      const intentId = path.match(/^\/v1\/intents\/([a-f0-9]{32})$/)?.[1];
      if (intentId && req.method === "GET") {
        for (const route of [
          { context: cfg, table: "developer_intents", mode: "v2" as const },
          ...(v3?.v3Mode
            ? [{ context: v3, table: "developer_v3_intents", mode: "v3" as const }]
            : []),
        ]) {
          const rows = await route.context.db.query(
            `SELECT i.id, i.status, i.order_type AS "orderType", i.deadline::text AS deadline, i.deposit_id::text AS "depositId", i.amount_out::text AS "amountOut", s.tx_hash AS "payoutTx", i.blocked_reason AS "blockedReason"
            FROM ${route.table} d JOIN intents i ON i.id = d.intent_id LEFT JOIN settlements s ON s.id = i.settlement_id AND s.status = 'confirmed'
            WHERE d.key_id = $1 AND i.id = $2`,
            [keyId, intentId],
          );
          if (rows[0]) return reply({ ...rows[0], privacyRoute: route.mode });
        }
        throw new ApiError(404, "Intent not found for this key");
      }
      throw new ApiError(404, "Not found");
    } catch (e) {
      if (e instanceof ApiError) {
        const res = reply({ error: e.message }, e.status);
        if (e.status === 429) res.headers.set("retry-after", "60");
        return res;
      }
      if (e instanceof IntentError || e instanceof SyntaxError)
        return reply({ error: e.message }, 400);
      // Never log credentials, signature bodies, or escape ticket material.
      console.error("Developer API request failed");
      return reply({ error: "Service temporarily unavailable" }, 503);
    }
  };
}
