// circomlibjs does not publish TypeScript declarations; its runtime shape is typed below where used.
// @ts-expect-error -- validated runtime dependency with no bundled declarations
import { buildPoseidon } from "circomlibjs";
import { decodeEventLog, getAddress, parseAbi, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import type { Db } from "@curtain/db";

export const POOL_V4_ABI = parseAbi([
  "event NoteShielded(address indexed token,uint256 amount,bytes32 indexed commitment)",
  "function publishRoot(bytes32 root)",
]);
const ROOT_MANAGER_ABI = parseAbi(["function publishRoot(bytes32 root)"]);
const DEPTH = 16;
const LOG_CHUNK_SIZE = 2_000n;

export interface PoolV4Config {
  db: Db;
  publicClient: PublicClient;
  walletClient: WalletClient;
  pool: Address;
  rootManager: Address;
  startBlock: bigint;
  rescanBlocks?: bigint;
}

export interface PoolV4Witness {
  commitment: Hex;
  token: Address;
  amount: string;
  root: Hex;
  siblings: Hex[];
  pathBits: number[];
}

/** Indexes public V4 commitments and publishes the corresponding append-only Poseidon root. */
export class PoolV4RootPublisher {
  private readonly rescan: bigint;
  private readonly poseidonPromise = buildPoseidon();

  constructor(private cfg: PoolV4Config) {
    this.rescan = cfg.rescanBlocks ?? 200n;
  }

  async sync(): Promise<{ added: number; root?: Hex; txHash?: Hex }> {
    const cursor = await this.cfg.db.query<{ block: string }>("SELECT block FROM pool_v4_cursor WHERE id = 1");
    const next = cursor[0] ? BigInt(cursor[0].block) + 1n : this.cfg.startBlock;
    const head = await this.cfg.publicClient.getBlockNumber();
    const from = next - this.rescan > this.cfg.startBlock ? next - this.rescan : this.cfg.startBlock;
    if (from > head) return { added: 0 };

    // Robinhood RPC providers cap eth_getLogs ranges. Chunk the initial backfill and every
    // rescan so a fresh operator can recover instead of retrying one oversized request forever.
    const logs = [] as Awaited<ReturnType<PublicClient["getLogs"]>>;
    for (let chunkFrom = from; chunkFrom <= head; chunkFrom += LOG_CHUNK_SIZE) {
      const chunkTo = chunkFrom + LOG_CHUNK_SIZE - 1n < head ? chunkFrom + LOG_CHUNK_SIZE - 1n : head;
      logs.push(...await this.cfg.publicClient.getLogs({ address: this.cfg.pool, fromBlock: chunkFrom, toBlock: chunkTo }));
    }
    let added = 0;
    await this.cfg.db.transaction(async (tx) => {
      for (const log of logs) {
        try {
          const event = decodeEventLog({ abi: POOL_V4_ABI, data: log.data, topics: log.topics });
          if (event.eventName !== "NoteShielded") continue;
          const args = event.args as unknown as { token: Address; amount: bigint; commitment: Hex };
          const result = await tx.query(
            `INSERT INTO pool_v4_notes (commitment, token, amount, block, log_index, tx_hash)
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (commitment) DO NOTHING RETURNING commitment`,
            [args.commitment.toLowerCase(), getAddress(args.token), args.amount.toString(), log.blockNumber?.toString() ?? "0", Number(log.logIndex ?? 0), log.transactionHash],
          );
          if (result.length) added++;
        } catch {
          // Ignore logs from a different ABI topic or an RPC reorg duplicate.
        }
      }
      await tx.query(
        `INSERT INTO pool_v4_cursor (id, block) VALUES (1, $1)
         ON CONFLICT (id) DO UPDATE SET block = GREATEST(pool_v4_cursor.block, EXCLUDED.block)`,
        [head.toString()],
      );
    });
    if (!added) return { added };
    const root = await this.root();
    const hash = await this.cfg.walletClient.writeContract({
      chain: this.cfg.walletClient.chain,
      account: this.cfg.walletClient.account!,
      address: this.cfg.rootManager,
      abi: ROOT_MANAGER_ABI,
      functionName: "publishRoot",
      args: [root],
    });
    await this.cfg.publicClient.waitForTransactionReceipt({ hash });
    return { added, root, txHash: hash };
  }

  async root(): Promise<Hex> {
    const rows = await this.cfg.db.query<{ commitment: string }>("SELECT commitment FROM pool_v4_notes ORDER BY block, log_index");
    const poseidon = await this.poseidonPromise;
    const leaves = rows.map((row) => BigInt(row.commitment));
    if (leaves.length > 2 ** DEPTH) throw new Error("Pool V4 Merkle tree is full");
    while (leaves.length < 2 ** DEPTH) leaves.push(0n);
    let level = leaves;
    for (let depth = 0; depth < DEPTH; depth++) {
      const next: bigint[] = [];
      for (let i = 0; i < level.length; i += 2) next.push(poseidon.F.toObject(poseidon([level[i]!, level[i + 1]!] )));
      level = next;
    }
    return (`0x${level[0]!.toString(16).padStart(64, "0")}`) as Hex;
  }

  async witness(commitment: Hex): Promise<PoolV4Witness | undefined> {
    const rows = await this.cfg.db.query<{ commitment: string; token: Address; amount: string }>(
      "SELECT commitment, token, amount FROM pool_v4_notes ORDER BY block, log_index",
    );
    const index = rows.findIndex((row) => row.commitment.toLowerCase() === commitment.toLowerCase());
    if (index < 0) return undefined;
    const poseidon = await this.poseidonPromise;
    const leaves = rows.map((row) => BigInt(row.commitment));
    while (leaves.length < 2 ** DEPTH) leaves.push(0n);
    let current = index;
    let level = leaves;
    const siblings: Hex[] = [];
    const pathBits: number[] = [];
    for (let depth = 0; depth < DEPTH; depth++) {
      pathBits.push(current % 2);
      siblings.push((`0x${level[current ^ 1]!.toString(16).padStart(64, "0")}`) as Hex);
      const next: bigint[] = [];
      for (let i = 0; i < level.length; i += 2) next.push(poseidon.F.toObject(poseidon([level[i]!, level[i + 1]!] )));
      level = next;
      current = Math.floor(current / 2);
    }
    return { commitment, token: getAddress(rows[index]!.token), amount: rows[index]!.amount, root: (`0x${level[0]!.toString(16).padStart(64, "0")}`) as Hex, siblings, pathBits };
  }
}
