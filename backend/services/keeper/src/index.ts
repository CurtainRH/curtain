/**
 * Curtain keeper: fetches signed settlements from an operator's public API and lands them on
 * CurtainVault, earning their keeper fees. The signature fixes the swap, recipients and
 * amounts, so a keeper can't redirect anything; the worst it can do is not submit.
 *
 * Each settlement is simulated first so a keeper never pays gas for one that would revert
 * (price moved below its minimum, already landed by another keeper, expired).
 */
import { getAddress, parseAbi, type Address, type Hex, type PublicClient, type WalletClient } from "viem";

const VAULT_ABI = parseAbi([
  "struct Swap { address router; address tokenIn; uint256 amountIn; address tokenOut; uint256 minOut; bytes data; }",
  "struct Payout { address recipient; uint256 amount; uint256 protocolFee; uint256 keeperFee; bytes32 tag; }",
  "function settle(Swap s, Payout[] payouts, uint256 deadline, uint256 nonce, bytes signature)",
  "function nonceUsed(uint256) view returns (bool)",
]);

export interface PendingSettlement {
  swap: { router: Address; tokenIn: Address; amountIn: string; tokenOut: Address; minOut: string; data: Hex };
  payouts: { recipient: Address; amount: string; protocolFee: string; keeperFee: string; tag: Hex }[];
  deadline: string;
  nonce: string;
  signature: Hex;
}

export interface KeeperConfig {
  operatorApi: string;
  vault: Address;
  publicClient: PublicClient;
  walletClient: WalletClient;
  /** Minimum total keeper fee worth submitting for, per output token (raw units). */
  minFee?: Record<string, bigint>;
  fetch?: typeof fetch;
  contexts?: { version: "v2" | "v3"; vault: Address }[];
}

export class Keeper {
  constructor(private cfg: KeeperConfig) {}

  async pending(version: "v2" | "v3" = "v2"): Promise<PendingSettlement[]> {
    const base = this.cfg.operatorApi.replace(/\/+$/, "");
    const res = await (this.cfg.fetch ?? fetch)(`${base}/settlements/pending`, { headers: { "x-curtain-version": version } });
    if (!res.ok) throw new Error(`operator API: HTTP ${res.status}`);
    return (await res.json()) as PendingSettlement[];
  }

  /** One pass: lands every worthwhile, unexpired, not-yet-landed settlement. Returns tx hashes. */
  async tick(nowSec: number): Promise<Hex[]> {
    const { publicClient, walletClient } = this.cfg;
    const sent: Hex[] = [];
    const contexts = this.cfg.contexts ?? [{ version: "v2" as const, vault: this.cfg.vault }];
    const pending = (await Promise.all(contexts.map(async (context) =>
      (await this.pending(context.version)).map((settlement) => ({ context, settlement }))))).flat();
    const candidates = pending.filter(({ settlement }) => {
      if (BigInt(settlement.deadline) < BigInt(nowSec)) return false;
      const fee = settlement.payouts.reduce((sum, p) => sum + BigInt(p.keeperFee), 0n);
      const floor = this.cfg.minFee?.[getAddress(settlement.swap.tokenOut)];
      return floor === undefined || fee >= floor;
    });
    let used: boolean[];
    try {
      used = await publicClient.multicall({
        allowFailure: false,
        contracts: candidates.map(({ context, settlement }) => ({
          address: context.vault,
          abi: VAULT_ABI,
          functionName: "nonceUsed" as const,
          args: [BigInt(settlement.nonce)] as const,
        })),
      });
    } catch {
      // Some RPCs do not expose Multicall3 reliably. Preserve keeper progress with a safe fallback.
      used = await Promise.all(candidates.map(({ context, settlement }) =>
        publicClient.readContract({
          address: context.vault,
          abi: VAULT_ABI,
          functionName: "nonceUsed",
          args: [BigInt(settlement.nonce)],
        })));
    }
    for (const [index, { context, settlement: s }] of candidates.entries()) {
      if (used[index]) continue;
      const args = [
        { ...s.swap, amountIn: BigInt(s.swap.amountIn), minOut: BigInt(s.swap.minOut) },
        s.payouts.map((p) => ({ recipient: p.recipient, amount: BigInt(p.amount), protocolFee: BigInt(p.protocolFee), keeperFee: BigInt(p.keeperFee), tag: p.tag })),
        BigInt(s.deadline), BigInt(s.nonce), s.signature,
      ] as const;
      try {
        const { request } = await publicClient.simulateContract({ account: walletClient.account!, address: context.vault, abi: VAULT_ABI, functionName: "settle", args });
        const hash = await walletClient.writeContract({ ...request, chain: walletClient.chain });
        const r = await publicClient.waitForTransactionReceipt({ hash });
        if (r.status === "success") sent.push(hash);
      } catch (e) {
        // Usually: another keeper won the race, or the price moved below the minimum.
        console.error(`settlement ${s.nonce}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      }
    }
    return sent;
  }
}
