import { describe, expect, test } from "bun:test";
import { migrate } from "@curtain/db";
import { pgliteDb } from "@curtain/db/pglite";
import type { Address } from "viem";
import { createApi } from "../src/api";
import { Operator } from "../src/operator";

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address;
const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" as Address;
const VAULT = "0xF9381841e982648c178E762116A437Ecbcf12Bbd" as Address;

async function setup(anonymitySet: boolean) {
  const db = await pgliteDb();
  await migrate(db);
  // waitingDeposits only reads the database; the chain clients are never touched.
  const op = new Operator({
    db, publicClient: {} as never, walletClient: { account: { address: VAULT } } as never, chainId: 4663, vault: VAULT, router: VAULT,
    route: () => "0x", quote: async () => ({ amountOut: 0n }), keeperFeeBps: 5, anonymitySet,
  });
  const api = createApi({ db, operator: op, vault: VAULT, tokens: { USDG, NVDA }, keeperFeeBps: 5 });
  const get = async (path: string) => {
    const res = await api(new Request(`http://op${path}`));
    return { status: res.status, body: (await res.json()) as any };
  };
  let n = 0;
  const intent = (tokenIn: Address, status: string) =>
    db.query(
      `INSERT INTO intents (id, deadline_hash, deadline, salt, pay_at, mode, token_in, amount_in, token_out, recipient, min_out, secret, depositor, status)
       VALUES ($1, $2, 1, '0x', 1, 'instant', $3, 1, $4, $4, 1, '0x', $4, $5)`,
      [`i${++n}`, `h${n}`, tokenIn.toLowerCase(), NVDA, status],
    );
  return { get, intent };
}

describe("anonymity set (/pool)", () => {
  test("off unless enabled", async () => {
    const { get } = await setup(false);
    expect((await get("/pool")).status).toBe(404);
    expect((await get("/config")).body.pool).toBeUndefined();
  });

  test("counts only deposits received and not yet paid, per input token, case-insensitively", async () => {
    const { get, intent } = await setup(true);
    expect((await get("/config")).body.pool).toEqual({ enabled: true });
    for (const s of ["deposited", "deposited", "settling", "awaiting_deposit", "paid", "refunded", "blocked", "expired", "challenged", "refund_requested"]) await intent(USDG, s);
    await intent(NVDA, "deposited");
    // Only deposited + settling count: 2 + 1 for USDG (stored lowercase), 1 for NVDA.
    expect((await get("/pool")).body).toEqual({ total: 4, byToken: { [USDG]: 3, [NVDA]: 1 } });
  });

  test("an empty pool reads as zero", async () => {
    const { get } = await setup(true);
    expect((await get("/pool")).body).toEqual({ total: 0, byToken: {} });
  });

  test("result is cached for 30 seconds and exposes counts only", async () => {
    const { get, intent } = await setup(true);
    await intent(USDG, "deposited");
    await intent(USDG, "settling");
    await intent(NVDA, "deposited");
    const first = (await get("/pool")).body;
    expect(first).toEqual({ total: 3, byToken: { [USDG]: 2, [NVDA]: 1 } });
    await intent(USDG, "deposited");
    expect((await get("/pool")).body).toEqual(first); // cached
  });
});
