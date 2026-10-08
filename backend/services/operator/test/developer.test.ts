import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { migrate, type Db } from "@curtain/db";
import { pgliteDb } from "@curtain/db/pglite";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decodeFunctionData, type Address } from "viem";
import { VAULT_ABI, ERC20_ABI, deadlineHashOf } from "@curtain/sdk";
import { createApi } from "../src/api";
import type { Operator } from "../src/operator";

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address;
const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" as Address;
const VAULT = "0xF9381841e982648c178E762116A437Ecbcf12Bbd" as Address;
const V3_VAULT = "0xBF643c56D6f1775f9ABe97b7B7e89b0265D6c67a" as Address;
const alice = privateKeyToAccount(generatePrivateKey());
const bob = privateKeyToAccount(generatePrivateKey());
let db: Db;
let v3db: Db;
let handle: ReturnType<typeof createApi>;
let clock = Math.floor(Date.now() / 1000);
let ip = 0;
setDefaultTimeout(30_000);
async function request(path: string, body?: unknown, key?: string, requestId?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": `test-${ip++}`,
  };
  if (key) headers.authorization = `Bearer ${key}`;
  if (requestId) headers["idempotency-key"] = requestId;
  const res = await handle(
    new Request(`http://operator${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  return { status: res.status, headers: res.headers, body: (await res.json()) as any };
}
async function proof(action: string, fields = {}, signer = alice) {
  const challenge = await request("/developer/challenge", {
    wallet: signer.address,
    action,
    ...fields,
  });
  expect(challenge.status).toBe(200);
  return {
    challengeId: challenge.body.challengeId,
    signature: await signer.signMessage({ message: challenge.body.message }),
  };
}
async function key(signer = alice) {
  return (
    await request("/developer/keys/create", await proof("create", { name: "Integration" }, signer))
  ).body;
}
const params = () => ({
  privacyRoute: "v2",
  tokenIn: USDG,
  tokenOut: NVDA,
  amountIn: "10000000",
  minOut: "1",
  depositor: alice.address,
  recipient: bob.address,
  delaySeconds: 0,
});

beforeAll(async () => {
  db = await pgliteDb();
  await migrate(db);
  v3db = await pgliteDb();
  await migrate(v3db);
  const operator = {
    quoteForUser: async () => ({ available: true, minOutSuggested: "99" }),
  } as unknown as Operator;
  const v3operator = {
    quoteForUser: async () => ({ available: true, minOutSuggested: "88" }),
  } as unknown as Operator;
  handle = createApi({
    db,
    operator,
    vault: VAULT,
    tokens: { USDG, NVDA },
    keeperFeeBps: 5,
    chainId: 4663,
    now: () => clock,
    contexts: {
      v2: { db, operator, vault: VAULT, tokens: { USDG, NVDA }, keeperFeeBps: 5 },
      v3: {
        db: v3db,
        operator: v3operator,
        vault: V3_VAULT,
        tokens: { USDG, NVDA },
        keeperFeeBps: 5,
        v3Mode: true,
        fixedAmounts: new Set([`${USDG}:10000000`]),
      },
    },
  });
}, 30000);

describe("developer access and V2/V3 API", () => {
  test("stores only a key hash and never returns secrets from listing", async () => {
    const created = await key();
    expect(created.apiKey).toMatch(/^ctn_live_/);
    const rows = await db.query("SELECT * FROM developer_keys WHERE id = $1", [created.key.id]);
    expect(JSON.stringify(rows)).not.toContain(created.apiKey);
    const listed = await request("/developer/keys/list", await proof("list"));
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toContain(created.apiKey);
    expect(JSON.stringify(listed.body)).not.toContain("key_hash");
    expect(listed.headers.get("cache-control")).toBe("no-store");
  });
  test("rejects wrong signers, action substitution, replay, and expired signatures", async () => {
    const c = await request("/developer/challenge", { wallet: alice.address, action: "list" });
    const wrong = await bob.signMessage({ message: c.body.message });
    expect(
      (await request("/developer/keys/list", { challengeId: c.body.challengeId, signature: wrong }))
        .status,
    ).toBe(401);
    const valid = {
      challengeId: c.body.challengeId,
      signature: await alice.signMessage({ message: c.body.message }),
    };
    expect((await request("/developer/keys/create", valid)).status).toBe(401);
    expect((await request("/developer/keys/list", valid)).status).toBe(200);
    expect((await request("/developer/keys/list", valid)).status).toBe(401);
    const expired = await proof("list");
    clock += 301;
    expect((await request("/developer/keys/list", expired)).status).toBe(401);
  });
  test("signature binds the key name, and one wallet cannot revoke another's key", async () => {
    const signed = await proof("create", { name: "Signed name" });
    const created = await request("/developer/keys/create", { ...signed, name: "Injected name" });
    expect(created.body.key.name).toBe("Signed name");
    expect(
      (
        await request(
          "/developer/keys/revoke",
          await proof("revoke", { keyId: created.body.key.id }, bob),
        )
      ).status,
    ).toBe(404);
  });
  test("requires bearer auth and exposes explicit and dynamic route quotes", async () => {
    const created = await key();
    expect((await request("/v1/config")).status).toBe(401);
    expect((await request("/v1/config", undefined, created.apiKey)).body.vault).toBe(VAULT);
    const query = `tokenIn=${USDG}&tokenOut=${NVDA}&amountIn=10000000`;
    expect((await request("/v1/config", undefined, created.apiKey)).body.privacyRoutes).toEqual([
      "v2",
      "v3",
      "dynamic",
    ]);
    expect(
      (await request(`/v1/quote?${query}&privacyRoute=v3`, undefined, created.apiKey)).body
        .minOutSuggested,
    ).toBe("88");
    expect(
      (await request(`/v1/quote?${query}&privacyRoute=v2`, undefined, created.apiKey)).body
        .minOutSuggested,
    ).toBe("99");
    expect(
      (await request(`/v1/quote?${query}&privacyRoute=dynamic`, undefined, created.apiKey)).body
        .privacyRoute,
    ).toBe("v3");
    expect(
      (
        await request(
          `/v1/quote?${query.replace("10000000", "20000000")}&privacyRoute=dynamic`,
          undefined,
          created.apiKey,
        )
      ).body.privacyRoute,
    ).toBe("v2");
    expect(
      (
        await request(
          `/v1/quote?${query.replace("10000000", "20000000")}&privacyRoute=v3`,
          undefined,
          created.apiKey,
        )
      ).status,
    ).toBe(400);
  });
  test("prepares accurate unsigned transactions and returns the same intent on retries", async () => {
    const created = await key();
    const first = await request("/v1/intents", params(), created.apiKey, "swap-1");
    expect(first.status).toBe(201);
    const ticket = first.body.escapeTicket;
    expect(deadlineHashOf(BigInt(ticket.deadline), ticket.salt)).toBe(ticket.deadlineHash);
    expect(first.body.transactions.deposit.to).toBe(VAULT);
    expect(first.body.transactions.deposit.from).toBe(alice.address);
    expect(
      decodeFunctionData({ abi: VAULT_ABI, data: first.body.transactions.deposit.data }).args,
    ).toEqual([USDG, 10000000n, ticket.deadlineHash]);
    expect(
      decodeFunctionData({ abi: ERC20_ABI, data: first.body.transactions.approval.data }).args,
    ).toEqual([VAULT, 10000000n]);
    const again = await request("/v1/intents", params(), created.apiKey, "swap-1");
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(
      (
        await request(
          "/v1/intents",
          { ...params(), amountIn: "20000000" },
          created.apiKey,
          "swap-1",
        )
      ).status,
    ).toBe(409);
    expect(
      (await db.query("SELECT * FROM developer_intents WHERE key_id = $1", [created.key.id]))
        .length,
    ).toBe(1);
    expect(
      (await request(`/v1/intents/${first.body.id}`, undefined, created.apiKey)).body.status,
    ).toBe("awaiting_deposit");
    expect((await request(`/intents/${first.body.id}`)).status).toBe(404);
    const other = await key(bob);
    expect((await request(`/v1/intents/${first.body.id}`, undefined, other.apiKey)).status).toBe(
      404,
    );
    expect(
      (await request("/developer/keys/revoke", await proof("revoke", { keyId: created.key.id })))
        .status,
    ).toBe(200);
    expect((await request("/v1/config", undefined, created.apiKey)).status).toBe(401);
  });
  test("V3 prepares the V3 vault and tagged escape ticket, and validates fixed amounts", async () => {
    const created = await key();
    const first = await request(
      "/v1/intents",
      { ...params(), privacyRoute: "v3" },
      created.apiKey,
      "v3-swap",
    );
    expect(first.status).toBe(201);
    expect(first.body.privacyRoute).toBe("v3");
    expect(first.body.vault).toBe(V3_VAULT);
    expect(first.body.escapeTicket.tag).toMatch(/^0x[0-9a-f]{64}$/);
    expect(first.body.transactions.deposit.to).toBe(V3_VAULT);
    expect(first.body.transactions.deposit.from).toBe(alice.address);
    expect(
      (
        await request(
          "/v1/intents",
          { ...params(), privacyRoute: "v3", amountIn: "20000000" },
          created.apiKey,
          "v3-invalid",
        )
      ).status,
    ).toBe(400);
    const again = await request(
      "/v1/intents",
      { ...params(), privacyRoute: "v3" },
      created.apiKey,
      "v3-swap",
    );
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect((await request(`/v1/intents/${first.body.id}`, undefined, created.apiKey)).status).toBe(
      200,
    );
    const dynamic = await request(
      "/v1/intents",
      { ...params(), privacyRoute: "dynamic" },
      created.apiKey,
      "dynamic-v3-swap",
    );
    expect(dynamic.status).toBe(201);
    expect(dynamic.body.privacyRoute).toBe("v3");
    expect(dynamic.body.vault).toBe(V3_VAULT);
    expect((await request(`/intents/${first.body.id}`)).status).toBe(404);
  });
  test("rejects invalid amounts, missing idempotency keys and unsupported split parameters", async () => {
    const created = await key(bob);
    expect((await request("/v1/intents", params(), created.apiKey)).status).toBe(400);
    for (const overrides of [
      { amountIn: "1.2" },
      { amountIn: "0" },
      { minOut: "-1" },
      { delaySeconds: 0.2 },
      { splits: [] },
      { recipient: VAULT },
    ]) {
      expect(
        (await request("/v1/intents", { ...params(), ...overrides }, created.apiKey, "invalid"))
          .status,
      ).toBe(400);
    }
    expect(
      (await db.query("SELECT * FROM developer_intents WHERE key_id = $1", [created.key.id]))
        .length,
    ).toBe(0);
  });
  test("enforces per-key rate limits in shared database and recovers in next window", async () => {
    clock += 301;
    const created = await key(bob);
    for (let i = 0; i < 60; i++)
      expect((await request("/v1/config", undefined, created.apiKey)).status).toBe(200);
    const limited = await request("/v1/config", undefined, created.apiKey);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    clock += 60;
    expect((await request("/v1/config", undefined, created.apiKey)).status).toBe(200);
  });
  test("concurrent retries create one intent, and oversized bodies cannot create intents", async () => {
    clock += 301;
    const created = await key(bob);
    const results = await Promise.all([
      request("/v1/intents", params(), created.apiKey, "parallel"),
      request("/v1/intents", params(), created.apiKey, "parallel"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(results[0]!.body.id).toBe(results[1]!.body.id);
    expect(
      (await db.query("SELECT * FROM developer_intents WHERE key_id = $1", [created.key.id]))
        .length,
    ).toBe(1);
    expect(
      (
        await request(
          "/v1/intents",
          { ...params(), padding: "x".repeat(17000) },
          created.apiKey,
          "oversized",
        )
      ).status,
    ).toBe(413);
  });
  test("the V3 header cannot override the developer API's explicit route", async () => {
    const created = await key(bob);
    const res = await handle(
      new Request("http://operator/v1/config", {
        headers: { authorization: `Bearer ${created.apiKey}`, "x-curtain-version": "v3" },
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { privacyRoutes: string[] }).privacyRoutes).toEqual([
      "v2",
      "v3",
      "dynamic",
    ]);
  });
});
