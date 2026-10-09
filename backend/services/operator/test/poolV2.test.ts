import { describe, expect, test } from "bun:test";
import { migrate } from "@curtain/db";
import { pgliteDb } from "@curtain/db/pglite";
import type { Address } from "viem";
import { PoolV2RootPublisher } from "../src/poolV2";

const TOKEN = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address;
const POOL = "0x38147c547cDE831812CD075166E279B77FF164Cc" as Address;
const OTHER_POOL = "0x1111111111111111111111111111111111111111" as Address;
const FIRST = "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`;
const SECOND = "0x0000000000000000000000000000000000000000000000000000000000000002" as `0x${string}`;

describe("Pool V2 root publisher", () => {
  test("builds a fixed-depth witness from indexed notes", async () => {
    const db = await pgliteDb();
    await migrate(db);
    await db.query(
      `INSERT INTO pool_v4_notes (pool_address, commitment, token, amount, block, log_index, tx_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7), ($1, $8, $3, $9, $5, $10, $11)`,
      [POOL.toLowerCase(), FIRST, TOKEN.toLowerCase(), "1000000", 10, 0, "0x01", SECOND, "2000000", 1, "0x02"],
    );

    const publisher = new PoolV2RootPublisher({
      db,
      publicClient: {} as never,
      walletClient: {} as never,
      pool: POOL,
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
    const publisher = new PoolV2RootPublisher({
      db,
      publicClient: {} as never,
      walletClient: {} as never,
      pool: POOL,
      rootManager: TOKEN,
      startBlock: 0n,
    });
    expect(await publisher.witness(FIRST)).toBeUndefined();
  });

  test("isolates notes and roots by pool deployment", async () => {
    const db = await pgliteDb();
    await migrate(db);
    await db.query(
      `INSERT INTO pool_v4_notes (pool_address, commitment, token, amount, block, log_index, tx_hash)
       VALUES ($1, $2, $3, $4, 10, 0, '0x01'), ($5, $6, $3, $4, 10, 0, '0x02')`,
      [POOL.toLowerCase(), FIRST, TOKEN.toLowerCase(), "1000000", OTHER_POOL.toLowerCase(), SECOND],
    );
    const publisher = (pool: Address) => new PoolV2RootPublisher({
      db, publicClient: {} as never, walletClient: {} as never, pool, rootManager: TOKEN, startBlock: 0n,
    });

    const [firstRoot, secondRoot] = await Promise.all([publisher(POOL).root(), publisher(OTHER_POOL).root()]);
    expect(firstRoot).not.toBe(secondRoot);
    expect(await publisher(POOL).witness(FIRST)).toBeDefined();
    expect(await publisher(OTHER_POOL).witness(FIRST)).toBeUndefined();
    expect(await publisher(OTHER_POOL).witness(SECOND)).toBeDefined();
  });

  test("persists an empty-pool cursor instead of rescanning from deployment every tick", async () => {
    const db = await pgliteDb();
    await migrate(db);
    const ranges: [bigint, bigint][] = [];
    const publicClient = {
      getBlockNumber: async () => 1_000n,
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        ranges.push([fromBlock, toBlock]);
        return [];
      },
    } as never;
    const publisher = new PoolV2RootPublisher({ db, publicClient, walletClient: {} as never, pool: POOL, rootManager: TOKEN, startBlock: 100n });

    await publisher.sync();
    await publisher.sync();

    expect(ranges).toEqual([[100n, 1_000n], [801n, 1_000n]]);
  });
});
