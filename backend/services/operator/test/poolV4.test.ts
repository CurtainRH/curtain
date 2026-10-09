import { describe, expect, test } from "bun:test";
import { migrate } from "@curtain/db";
import { pgliteDb } from "@curtain/db/pglite";
import type { Address } from "viem";
import { PoolV4RootPublisher } from "../src/poolV4";

const TOKEN = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address;
const FIRST = "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`;
const SECOND = "0x0000000000000000000000000000000000000000000000000000000000000002" as `0x${string}`;

describe("Pool V4 root publisher", () => {
  test("builds a fixed-depth witness from indexed notes", async () => {
    const db = await pgliteDb();
    await migrate(db);
    await db.query(
      `INSERT INTO pool_v4_notes (commitment, token, amount, block, log_index, tx_hash)
       VALUES ($1, $2, $3, $4, $5, $6), ($7, $2, $8, $4, $9, $10)`,
      [FIRST, TOKEN.toLowerCase(), "1000000", 10, 0, "0x01", SECOND, "2000000", 1, "0x02"],
    );

    const publisher = new PoolV4RootPublisher({
      db,
      publicClient: {} as never,
      walletClient: {} as never,
      pool: TOKEN,
      rootManager: TOKEN,
      startBlock: 0n,
    });

    const root = await publisher.root();
    const witness = await publisher.witness(FIRST);
    expect(root).toMatch(/^0x[\da-f]{64}$/);
    expect(witness).toBeDefined();
    expect(witness?.root).toBe(root);
    expect(witness?.token).toBe(TOKEN);
    expect(witness?.amount).toBe("1000000");
    expect(witness?.siblings).toHaveLength(16);
    expect(witness?.pathBits).toHaveLength(16);
    expect(witness?.pathBits[0]).toBe(0);
  });

  test("does not return witnesses for unknown commitments", async () => {
    const db = await pgliteDb();
    await migrate(db);
    const publisher = new PoolV4RootPublisher({
      db,
      publicClient: {} as never,
      walletClient: {} as never,
      pool: TOKEN,
      rootManager: TOKEN,
      startBlock: 0n,
    });
    expect(await publisher.witness(FIRST)).toBeUndefined();
  });
});
