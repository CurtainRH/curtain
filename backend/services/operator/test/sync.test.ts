import { describe, expect, test } from "bun:test";
import { migrate } from "@curtain/db";
import { pgliteDb } from "@curtain/db/pglite";
import { CurtainClient, openBackup, sealBackup, syncKeysFromSignature, TICKET_SYNC_MESSAGE } from "@curtain/sdk";
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createApi, MAX_SYNC_BODY } from "../src/api";
import { Operator } from "../src/operator";

const VAULT = "0xF9381841e982648c178E762116A437Ecbcf12Bbd" as Address;

async function setup(ticketSync: boolean) {
  const db = await pgliteDb();
  await migrate(db);
  const op = new Operator({
    db, publicClient: {} as never, walletClient: { account: { address: VAULT } } as never, chainId: 4663, vault: VAULT, router: VAULT,
    route: () => "0x", quote: async () => ({ amountOut: 0n }), keeperFeeBps: 5, ticketSync,
  });
  const api = createApi({ db, operator: op, vault: VAULT, tokens: {}, keeperFeeBps: 5 });
  const client = new CurtainClient({ apiUrl: "http://op", publicClient: {} as never, fetch: ((input: string | URL | Request, init?: RequestInit) => api(new Request(String(input), init))) as typeof fetch });
  return { db, api, client };
}

const sign = (key: Hex) => privateKeyToAccount(key).signMessage({ message: TICKET_SYNC_MESSAGE });
const tickets = [{ intentId: "ab".repeat(16), ticket: { vault: VAULT, depositId: "7", deadline: "1791328417", salt: `0x${"7a".repeat(32)}` }, tokenIn: "USDG", amountIn: "1200" }];

describe("ticket sync", () => {
  test("keys are deterministic, wallet-specific, and ignore the signature's v byte", async () => {
    const key = generatePrivateKey();
    const sig = await sign(key);
    const a = syncKeysFromSignature(sig);
    expect(syncKeysFromSignature(await sign(key))).toEqual(a);
    // Same r and s with v as 0/1 instead of 27/28: same keys.
    const v = parseInt(sig.slice(130), 16);
    expect(syncKeysFromSignature(`${sig.slice(0, 130)}${(v >= 27 ? v - 27 : v + 27).toString(16).padStart(2, "0")}` as Hex)).toEqual(a);
    expect(syncKeysFromSignature(await sign(generatePrivateKey())).id).not.toBe(a.id);
    // The storage id is not the wallet address in any form.
    expect(a.id.toLowerCase()).not.toContain(privateKeyToAccount(key).address.slice(2).toLowerCase());
  });

  test("backs up and restores through the API; the operator only holds an opaque blob", async () => {
    const { db, client } = await setup(true);
    const keys = syncKeysFromSignature(await sign(generatePrivateKey()));
    expect(await client.pullBackup(keys)).toBeNull();
    await client.pushBackup(keys, await sealBackup(tickets, keys.encKey));
    const blob = await client.pullBackup(keys);
    expect(await openBackup(blob!, keys.encKey)).toEqual(tickets);
    const [row] = await db.query<{ blob: string; auth_hash: string }>("SELECT blob, auth_hash FROM ticket_sync");
    for (const secret of ["7a7a7a", "USDG", "1791328417", keys.authKey.slice(2), Buffer.from(keys.encKey).toString("hex")]) {
      expect(JSON.stringify(row)).not.toContain(secret);
    }
    // Updating works with the same keys.
    await client.pushBackup(keys, await sealBackup([...tickets, ...tickets], keys.encKey));
    expect(((await openBackup((await client.pullBackup(keys))!, keys.encKey)) as unknown[]).length).toBe(2);
  });

  test("only the original keys can overwrite a backup; other keys can't open it", async () => {
    const { api, client } = await setup(true);
    const owner = syncKeysFromSignature(await sign(generatePrivateKey()));
    await client.pushBackup(owner, await sealBackup(tickets, owner.encKey));
    const intruder = syncKeysFromSignature(await sign(generatePrivateKey()));
    const res = await api(new Request(`http://op/sync/${owner.id}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ authKey: intruder.authKey, blob: await sealBackup([], intruder.encKey) }),
    }));
    expect(res.status).toBe(403);
    expect(await openBackup((await client.pullBackup(owner))!, owner.encKey)).toEqual(tickets);
    await expect(openBackup((await client.pullBackup(owner))!, intruder.encKey)).rejects.toThrow();
  });

  test("rejects malformed and oversized writes, and tampered blobs don't open", async () => {
    const { api, client } = await setup(true);
    const keys = syncKeysFromSignature(await sign(generatePrivateKey()));
    const put = (body: unknown) => api(new Request(`http://op/sync/${keys.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    expect((await put({ authKey: "0x12", blob: "0x" + "00".repeat(40) })).status).toBe(400);
    expect((await put({ authKey: keys.authKey, blob: "0x1234" })).status).toBe(400);
    expect((await put({ authKey: keys.authKey, blob: "not hex" })).status).toBe(400);
    expect((await put({ authKey: keys.authKey, blob: "0x" + "ab".repeat(MAX_SYNC_BODY / 2) })).status).toBe(413);
    expect((await api(new Request("http://op/sync/0x1234"))).status).toBe(404);
    const blob = await sealBackup(tickets, keys.encKey);
    await client.pushBackup(keys, blob);
    const tampered = (blob.slice(0, -2) + (blob.endsWith("0") ? "1" : "0")) as Hex;
    await expect(openBackup(tampered, keys.encKey)).rejects.toThrow();
  });

  test("off unless enabled: the client reports it as unavailable, not as an empty backup", async () => {
    const { client } = await setup(false);
    const keys = syncKeysFromSignature(await sign(generatePrivateKey()));
    await expect(client.pullBackup(keys)).rejects.toThrow("isn't available");
    await expect(client.pushBackup(keys, await sealBackup(tickets, keys.encKey))).rejects.toThrow();
  });
});
