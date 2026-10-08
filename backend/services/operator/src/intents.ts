/**
 * Swap intents: the off-chain half of a private swap. The operator picks the payout time and
 * the hidden deadline; the user deposits with `deadlineHash` and keeps (deadline, salt) for
 * the escape hatch.
 */
import { randomBytes } from "node:crypto";
import { encodeAbiParameters, getAddress, isAddress, keccak256, type Address, type Hex } from "viem";
import type { Db } from "@curtain/db";
import { isCompressedPublicKey } from "@curtain/sdk/stealth";

export const MAX_DELAY_SECONDS = 180 * 24 * 3600; // 180 days
/** Instant swaps are paid as soon as the deposit lands; this bounds how long the user has to
 * deposit and the operator has to pay before the escape hatch opens (deadline + 3 min). */
export const INSTANT_DEADLINE_SECONDS = 600;
/** Delayed swaps: time after the latest scheduled payout before the deadline. */
export const DELAYED_GRACE_SECONDS = 600;

export interface IntentRequest {
  tokenIn: string;
  amountIn: string | bigint;
  tokenOut: string;
  recipient: string;
  /** The address that will call deposit(). Deposits are matched on (depositor, hash). */
  depositor: string;
  minOut: string | bigint;
  /** 0 = instant; otherwise the maximum random delay in seconds, capped here at 180 days. */
  delaySeconds: number;
  /** Stealth payout: `recipient` is a one-time stealth address (ERC-5564). */
  stealth?: { ephemeralPublicKey: string; viewTag: string };
  /** Gas-drop fee in tokenOut units; required with `stealth` (and per stealth split). */
  stealthFee?: bigint;
  /** Split payout: 2-5 recipients. `recipient` must be the first one. */
  splits?: { recipient: string; stealth?: { ephemeralPublicKey: string; viewTag: string } }[];
  /** "random" (default): random shares, each at least half an equal share. "equal": even shares. */
  splitMode?: "random" | "equal";
}

export const MAX_SPLITS = 5;

/** Shares in bps summing to exactly 10 000. Random shares are each at least half an equal share. */
export function splitShares(n: number, mode: "random" | "equal"): number[] {
  if (!Number.isInteger(n) || n < 2 || n > MAX_SPLITS) throw new IntentError(`a split needs 2 to ${MAX_SPLITS} recipients`);
  let shares: number[];
  if (mode === "equal") {
    shares = Array.from({ length: n }, () => Math.floor(10_000 / n));
  } else {
    const min = Math.floor(5_000 / n);
    const spare = 10_000 - min * n;
    const weights = Array.from({ length: n }, () => 1 + randomBytes(4).readUInt32BE(0) % 1_000_000);
    const total = weights.reduce((a, b) => a + b, 0);
    shares = weights.map((w) => min + Math.floor((spare * w) / total));
  }
  shares[n - 1]! += 10_000 - shares.reduce((a, b) => a + b, 0);
  return shares;
}

/** The smallest share a split of `n` can produce in `mode` (for quotes). */
export function minSplitShareBps(n: number, mode: "random" | "equal"): number {
  return mode === "equal" ? Math.floor(10_000 / n) : Math.floor(5_000 / n);
}

function checkStealth(st: { ephemeralPublicKey: string; viewTag: string }) {
  const { ephemeralPublicKey, viewTag } = st;
  if (typeof ephemeralPublicKey !== "string" || !isCompressedPublicKey(ephemeralPublicKey.toLowerCase())) {
    throw new IntentError("stealth.ephemeralPublicKey must be a compressed secp256k1 public key");
  }
  if (typeof viewTag !== "string" || !/^0x[0-9a-fA-F]{2}$/.test(viewTag)) throw new IntentError("stealth.viewTag must be one byte");
  return { eph: ephemeralPublicKey.toLowerCase(), tag: viewTag.toLowerCase() };
}

export interface Intent {
  id: string;
  deadline: bigint;
  salt: Hex;
  deadlineHash: Hex;
  tag?: Hex;
  payAt: bigint;
  /** Split payouts: each recipient's share in bps. */
  splits?: { recipient: Address; shareBps: number }[];
}

export class IntentError extends Error {}

const hex32 = () => `0x${randomBytes(32).toString("hex")}` as Hex;

export function deadlineHashOf(deadline: bigint, salt: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [deadline, salt]));
}

/** Uniform random integer in [0, max]. */
function randomUpTo(max: number): number {
  if (max <= 0) return 0;
  return Number(BigInt(`0x${randomBytes(8).toString("hex")}`) % BigInt(max + 1));
}

export async function createIntent(db: Db, req: IntentRequest, allowedTokens: Set<string>, vault: Address, nowSec: number, v3 = false, fixedAmounts?: Set<string>): Promise<Intent> {
  for (const [k, v] of [["tokenIn", req.tokenIn], ["tokenOut", req.tokenOut], ["recipient", req.recipient], ["depositor", req.depositor]] as const) {
    if (!isAddress(v)) throw new IntentError(`${k} is not an address`);
  }
  const recipient = getAddress(req.recipient);
  if (BigInt(recipient) === 0n || recipient === getAddress(vault)) throw new IntentError("recipient can't be the zero address or the vault");
  const tokenIn = getAddress(req.tokenIn);
  const tokenOut = getAddress(req.tokenOut);
  if (!allowedTokens.has(tokenIn) || !allowedTokens.has(tokenOut)) throw new IntentError("token not supported");
  const amountIn = BigInt(req.amountIn);
  if (v3 && fixedAmounts && !fixedAmounts.has(`${tokenIn}:${amountIn}`)) throw new IntentError("V3 only accepts an approved fixed denomination for this asset");
  const minOut = BigInt(req.minOut);
  if (amountIn <= 0n) throw new IntentError("amountIn must be positive");
  if (minOut <= 0n) throw new IntentError("minOut must be positive");
  let stealth: { eph: string; tag: string; fee: string } | null = null;
  if (req.stealth !== undefined) {
    if (req.splits) throw new IntentError("put stealth data on each split recipient instead");
    if (req.stealthFee === undefined || req.stealthFee <= 0n) throw new IntentError("stealth fee is missing");
    if (recipient === getAddress(req.depositor)) throw new IntentError("a stealth recipient can't be the depositor");
    stealth = { ...checkStealth(req.stealth), fee: req.stealthFee.toString() };
  }

  let splits: { recipient: Address; shareBps: number; eph: string | null; tag: string | null; fee: string | null }[] | null = null;
  if (req.splits !== undefined) {
    if (!Array.isArray(req.splits) || req.splits.length < 2 || req.splits.length > MAX_SPLITS) {
      throw new IntentError(`a split needs 2 to ${MAX_SPLITS} recipients`);
    }
    const mode = req.splitMode ?? "random";
    if (mode !== "random" && mode !== "equal") throw new IntentError("splitMode must be random or equal");
    const shares = splitShares(req.splits.length, mode);
    const seen = new Set<string>();
    splits = req.splits.map((sp, k) => {
      if (!sp || typeof sp.recipient !== "string" || !isAddress(sp.recipient)) throw new IntentError(`split recipient ${k + 1} is not an address`);
      const to = getAddress(sp.recipient);
      if (BigInt(to) === 0n || to === getAddress(vault)) throw new IntentError("a split recipient can't be the zero address or the vault");
      if (seen.has(to)) throw new IntentError("split recipients must be different addresses");
      seen.add(to);
      let st: { eph: string; tag: string } | null = null;
      if (sp.stealth !== undefined && sp.stealth !== null) {
        if (req.stealthFee === undefined || req.stealthFee <= 0n) throw new IntentError("stealth fee is missing");
        if (to === getAddress(req.depositor)) throw new IntentError("a stealth recipient can't be the depositor");
        st = checkStealth(sp.stealth);
      }
      return { recipient: to, shareBps: shares[k]!, eph: st?.eph ?? null, tag: st?.tag ?? null, fee: st ? req.stealthFee!.toString() : null };
    });
    if (splits[0]!.recipient !== recipient) throw new IntentError("recipient must be the first split recipient");
    if (splits.some((sp) => (minOut * BigInt(sp.shareBps)) / 10_000n === 0n)) throw new IntentError("this amount is too small to split");
  }
  const delay = Math.floor(req.delaySeconds);
  if (!(delay >= 0 && delay <= MAX_DELAY_SECONDS)) throw new IntentError(`delaySeconds must be 0..${MAX_DELAY_SECONDS}`);

  const instant = delay === 0;
  const payAt = BigInt(nowSec + (instant ? 0 : randomUpTo(delay)));
  const deadline = BigInt(nowSec + (instant ? INSTANT_DEADLINE_SECONDS : delay + DELAYED_GRACE_SECONDS));
  const salt = hex32();
  const secret = hex32();
  const tag = v3 ? keccak256(secret) : undefined;
  const deadlineHash = v3
    ? keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }, { type: "bytes32" }], [deadline, salt, tag!]))
    : deadlineHashOf(deadline, salt);
  const id = randomBytes(16).toString("hex");

  const intentParams = [
    id, deadlineHash, deadline.toString(), salt, payAt.toString(), instant ? "instant" : "delayed", tokenIn, amountIn.toString(),
    tokenOut, recipient, minOut.toString(), secret, getAddress(req.depositor), stealth?.eph ?? null, stealth?.tag ?? null, stealth?.fee ?? null,
  ];
  const insertIntent = async (tx: Db) => {
    await tx.query(
      `INSERT INTO intents (id, deadline_hash, deadline, salt, pay_at, mode, token_in, amount_in, token_out, recipient, min_out, secret, depositor,
                            stealth_ephemeral_pub, stealth_view_tag, stealth_fee)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`, intentParams,
    );
    for (const [position, sp] of (splits ?? []).entries()) {
      await tx.query(
        `INSERT INTO intent_splits (intent_id, position, recipient, share_bps, stealth_ephemeral_pub, stealth_view_tag, stealth_fee)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, position, sp.recipient, sp.shareBps, sp.eph, sp.tag, sp.fee],
      );
    }
  };
  // A normal intent is one atomic INSERT; avoid BEGIN/COMMIT round trips on the hot path.
  // Split intents still use a transaction because they also write intent_splits rows.
  if (splits) await db.transaction(insertIntent);
  else await insertIntent(db);
  return { id, deadline, salt, deadlineHash, payAt, ...(tag ? { tag } : {}), ...(splits ? { splits: splits.map(({ recipient: r, shareBps }) => ({ recipient: r, shareBps })) } : {}) };
}
