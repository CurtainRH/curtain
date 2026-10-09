import { buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";
import { decodeEventLog, encodeAbiParameters, erc20Abi, getAddress, parseAbi, type Address, type Hex, type PublicClient, type WalletClient } from "viem";

export const POOL_V4 = "0xf8f47571A55dB8745b7642515aF051D7B1e09dd3" as Address;
const PENDING_NOTE_PREFIX = "curtain:v4:pending:";
/** Safe to fall back before a V4 swap transaction has completed. */
export class PoolV4FallbackError extends Error {}
const POOL_ABI = parseAbi([
  "function swapAndShield(address target,address tokenIn,uint256 amountIn,address tokenOut,uint256 minOut,bytes swapData,bytes32 commitment) returns (uint256 amountOut)",
  "function unshield(bytes proof,bytes32 root,bytes32 nullifier,address token,uint256 amount,address recipient)",
  "event NoteShielded(address indexed token,uint256 amount,bytes32 indexed commitment)",
]);
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function randomField(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return BigInt(`0x${Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join("")}`) % FIELD;
}

async function commitment(secret: bigint, token: Address, amount: bigint): Promise<Hex> {
  const poseidon = await buildPoseidon();
  const value = poseidon.F.toObject(poseidon([secret, BigInt(token), amount]));
  return (`0x${value.toString(16).padStart(64, "0")}`) as Hex;
}

function proofBytes(proof: any, signals: string[]): Hex {
  const a = proof.pi_a.slice(0, 2).map(BigInt) as [bigint, bigint];
  const b = [[BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])], [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])]] as [[bigint, bigint], [bigint, bigint]];
  const c = proof.pi_c.slice(0, 2).map(BigInt) as [bigint, bigint];
  const inputs = signals.map(BigInt) as [bigint, bigint, bigint, bigint, bigint];
  return encodeAbiParameters([
    { type: "uint256[2]" }, { type: "uint256[2][2]" }, { type: "uint256[2]" }, { type: "uint256[5]" },
  ], [a, b, c, inputs]);
}

export async function poolV4Swap({
  publicClient, walletClient, tokenIn, tokenOut, amountIn, minOut, recipient, onStatus,
}: {
  publicClient: PublicClient; walletClient: WalletClient; tokenIn: Address; tokenOut: Address;
  amountIn: bigint; minOut: bigint; recipient: Address; onStatus?: (status: string) => void;
}): Promise<{ swapTx: Hex; unshieldTx: Hex; amountOut: bigint; commitment: Hex }> {
  const account = walletClient.account!.address;
  const secret = randomField();
  const nonce = randomField();
  const params = new URLSearchParams({ tokenIn, tokenOut, amountIn: amountIn.toString(), slippageBps: "100" });
  let quote: { available?: boolean; router?: Address; data?: Hex; minOut?: string; error?: string };
  try {
    quote = await (await fetch(`/api/curtain/pool-v4/quote?${params}`)).json() as typeof quote;
  } catch {
    throw new PoolV4FallbackError("V4 quoting is unavailable right now.");
  }
  if (!quote.available || !quote.router || !quote.data || !quote.minOut) throw new PoolV4FallbackError(quote.error ?? "V4 route is unavailable for this pair.");
  if (BigInt(quote.minOut) < minOut) throw new PoolV4FallbackError("V4 cannot meet the requested minimum received amount.");
  const quotedOutput = BigInt(quote.minOut);
  const noteCommitment = await commitment(secret, tokenOut, quotedOutput);
  // Persist the recovery material before any approval or shield transaction is signed.
  // It stays in this browser origin and is never sent to the operator.
  localStorage.setItem(`${PENDING_NOTE_PREFIX}${noteCommitment.toLowerCase()}`, JSON.stringify({
    secret: secret.toString(), nonce: nonce.toString(), tokenOut, amount: quotedOutput.toString(), recipient,
    createdAt: new Date().toISOString(),
  }));
  onStatus?.("Approve the pool");
  const allowance = await publicClient.readContract({ address: tokenIn, abi: erc20Abi, functionName: "allowance", args: [account, POOL_V4] });
  if (allowance < amountIn) {
    const approval = await walletClient.writeContract({ chain: walletClient.chain, account, address: tokenIn, abi: erc20Abi, functionName: "approve", args: [POOL_V4, amountIn] });
    await publicClient.waitForTransactionReceipt({ hash: approval });
  }
  onStatus?.("Confirm the private swap");
  const swapTx = await walletClient.writeContract({
    chain: walletClient.chain, account, address: POOL_V4, abi: POOL_ABI, functionName: "swapAndShield",
    args: [quote.router, tokenIn, amountIn, tokenOut, BigInt(quote.minOut), quote.data, noteCommitment],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: swapTx });
  if (receipt.status !== "success") throw new PoolV4FallbackError("The V4 transaction reverted before funds moved.");
  const note = receipt.logs.map((log) => {
    try { return decodeEventLog({ abi: POOL_ABI, data: log.data, topics: log.topics }) as any; } catch { return undefined; }
  }).find((event) => event?.eventName === "NoteShielded" && event.args.commitment?.toLowerCase() === noteCommitment.toLowerCase());
  if (!note) throw new Error("V4 swap succeeded but its shielded note was not found.");
  const amountOut = BigInt(note.args.amount);
  onStatus?.("Waiting for the private root");
  let witness: any;
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`/api/curtain/pool-v4/witness/${noteCommitment}`);
    if (res.ok) { witness = await res.json(); break; }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!witness) throw new Error("The private note was created, but the root publisher has not indexed it yet.");
  onStatus?.("Generating your private proof");
  const wasm = "/pool-v4/pool_unshield.wasm";
  const zkey = "/pool-v4/pool_unshield_production.zkey";
  const input = { secret: secret.toString(), tokenId: BigInt(tokenOut).toString(), amount: amountOut.toString(), nullifierNonce: nonce.toString(), siblings: witness.siblings.map(String), pathBits: witness.pathBits.map(Number), recipient: BigInt(recipient).toString() };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
  onStatus?.("Confirm the private delivery");
  const unshieldTx = await walletClient.writeContract({
    chain: walletClient.chain, account, address: POOL_V4, abi: POOL_ABI, functionName: "unshield",
    args: [proofBytes(proof, publicSignals), witness.root, (`0x${BigInt(publicSignals[1]!).toString(16).padStart(64, "0")}`) as Hex, getAddress(tokenOut), amountOut, recipient],
  });
  await publicClient.waitForTransactionReceipt({ hash: unshieldTx });
  localStorage.removeItem(`${PENDING_NOTE_PREFIX}${noteCommitment.toLowerCase()}`);
  return { swapTx, unshieldTx, amountOut, commitment: noteCommitment };
}
