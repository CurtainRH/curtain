import { describe, expect, test } from "bun:test";
import { migrate } from "@curtain/db";
import type { Address, Hex } from "viem";
import { createApi } from "../src/api";
import { Operator } from "../src/operator";

const VAULT = "0xF9381841e982648c178E762116A437Ecbcf12Bbd" as Address;
const STAKING = "0x0852E2B555090dFc537207f3cB2d9D936eDa2e7A" as Address;
const POOL = "0x5368049BBb06859e2fC9E78e315b164614097F67" as Address;
const ALICE = "0x000000000000000000000000000000000000a11c" as Address;
const TOKENS = ["0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68"] as Address[];

async function makeApi(staking = true) {
  const db = await import("@curtain/db/pglite").then(m => m.pgliteDb());
  await migrate(db);
  const operator = new Operator({ db, publicClient: {} as never, walletClient: { account: { address: VAULT } } as never, chainId: 4663, vault: VAULT, router: VAULT, route: () => "0x", quote: async () => ({ amountOut: 0n }), keeperFeeBps: 5 });
  const api = createApi({
    db, operator, vault: VAULT, tokens: {}, keeperFeeBps: 5, chainId: 4663,
    ...(staking ? { stockStaking: {
      address: STAKING, rewardPoolWallet: POOL,
      config: async () => ({ bundles: [{ id: 1, name: "Market Core" }] }),
      quoteStake: async () => ({ principalUsd: 1_000_000n, priceSource: "codex.io", deadline: 1_800_000_000, signature: "0xabcd" as Hex }),
      createClaim: async () => ({ rewardUsd: 123n, tokens: TOKENS, amounts: [10n, 20n], deadline: 1_800_000_000, signature: "0xbeef" as Hex }),
    } } : {}),
  });
  return { api, db };
}

describe("stock staking API", () => {
  test("publishes current terms and available bundle choices", async () => {
    const { api } = await makeApi();
    const response = await api(new Request("http://operator/staking/config"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: true, staking: STAKING, baseAprBps: 400, tiers: [{ id: 0, days: 30 }, { id: 1, days: 90 }, { id: 2, days: 180 }], bundles: [{ id: 1, name: "Market Core" }] });
  });

  test("signs a stake quote for the wallet, term, amount, and bundle", async () => {
    const { api } = await makeApi();
    const response = await api(new Request("http://operator/staking/stake-quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: ALICE, amount: "1000000000000000000", tierId: 1, bundleId: "1" }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ staking: STAKING, account: ALICE, amount: "1000000000000000000", tierId: 1, bundleId: "1", principalUsd: "1000000", priceSource: "codex.io", signature: "0xabcd" });
  });

  test("returns a single signed all-bundle claim package", async () => {
    const { api } = await makeApi();
    const response = await api(new Request("http://operator/staking/claim-signature", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ positionId: "17", account: ALICE }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ staking: STAKING, positionId: "17", account: ALICE, rewardUsd: "123", tokens: TOKENS, amounts: ["10", "20"], signature: "0xbeef" });
  });

  test("rejects malformed quote inputs and removes the former admin scheduling API", async () => {
    const { api } = await makeApi();
    const invalid = await api(new Request("http://operator/staking/stake-quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: ALICE, amount: "0", tierId: 4, bundleId: "0" }) }));
    expect(invalid.status).toBe(400);
    const removed = await api(new Request("http://operator/admin/staking/rewards", { method: "POST" }));
    expect(removed.status).toBe(404);
  });

  test("does not expose staking endpoints before contract configuration", async () => {
    const { api } = await makeApi(false);
    const response = await api(new Request("http://operator/staking/config"));
    expect(response.status).toBe(503);
  });
});
