import { describe, expect, test } from "bun:test";
import { migrate } from "@curtain/db";
import { pgliteDb } from "@curtain/db/pglite";
import type { Address, Hex } from "viem";
import { createApi } from "../src/api";
import { Operator } from "../src/operator";

const VAULT = "0xF9381841e982648c178E762116A437Ecbcf12Bbd" as Address;
const STAKING = "0x0852E2B555090dFc537207f3cB2d9D936eDa2e7A" as Address;
const POOL = "0x5368049BBb06859e2fC9E78e315b164614097F67" as Address;
const ALICE = "0x000000000000000000000000000000000000a11c" as Address;
const SPY = "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C" as Address;

describe("stock staking API", () => {
  test("returns a user claim voucher and requires the master key to schedule rewards", async () => {
    const db = await pgliteDb();
    await migrate(db);
    const operator = new Operator({
      db, publicClient: {} as never, walletClient: { account: { address: VAULT } } as never,
      chainId: 4663, vault: VAULT, router: VAULT, route: () => "0x",
      quote: async () => ({ amountOut: 0n }), keeperFeeBps: 5,
    });
    let scheduled: unknown;
    const api = createApi({
      db, operator, vault: VAULT, tokens: {}, keeperFeeBps: 5, chainId: 4663,
      stockStaking: {
        address: STAKING, rewardPoolWallet: POOL, masterAdminKey: "test-only-admin-key",
        createClaim: async () => ({ amount: 123n, nonce: 4n, deadline: 1_800_000_000, signature: "0xabcd" as Hex }),
        scheduleReward: async (args) => { scheduled = args; return `0x${"ab".repeat(32)}` as Hex; },
      },
    });
    const claim = await api(new Request("http://operator/staking/claim-signature", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ positionId: "17", account: ALICE, token: SPY }),
    }));
    expect(claim.status).toBe(200);
    expect(await claim.json()).toMatchObject({ staking: STAKING, account: ALICE, token: SPY, amount: "123", signature: "0xabcd" });

    const request = (key?: string) => api(new Request("http://operator/admin/staking/rewards", {
      method: "POST", headers: { "content-type": "application/json", ...(key ? { "x-master-admin-key": key } : {}) },
      body: JSON.stringify({ bundleId: "1", token: SPY, amount: "500000", durationSeconds: "2592000" }),
    }));
    expect((await request()).status).toBe(401);
    expect(scheduled).toBeUndefined();
    const adminResponse = await request("test-only-admin-key");
    expect(adminResponse.status).toBe(201);
    expect(scheduled).toEqual({ bundleId: 1n, token: SPY, amount: 500_000n, duration: 2_592_000n });
  });

  test("does not expose staking endpoints before contract configuration", async () => {
    const db = await pgliteDb();
    await migrate(db);
    const operator = new Operator({
      db, publicClient: {} as never, walletClient: { account: { address: VAULT } } as never,
      chainId: 4663, vault: VAULT, router: VAULT, route: () => "0x",
      quote: async () => ({ amountOut: 0n }), keeperFeeBps: 5,
    });
    const api = createApi({ db, operator, vault: VAULT, tokens: {}, keeperFeeBps: 5 });
    const response = await api(new Request("http://operator/staking/config"));
    expect(response.status).toBe(503);
  });
});
