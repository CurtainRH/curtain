import { buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";
import {
  createPublicClient, createWalletClient, decodeEventLog, defineChain, encodeAbiParameters, encodeFunctionData,
  formatUnits, http, parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { open, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

if (process.env.POOL_V2_TEST_CONFIRM !== "EXECUTE_MAINNET_TEST_SWAP") {
  throw new Error("Set POOL_V2_TEST_CONFIRM=EXECUTE_MAINNET_TEST_SWAP to authorize the bounded mainnet test.");
}

const here = dirname(fileURLToPath(import.meta.url));
const backend = resolve(here, "../..");
const repo = resolve(backend, "..");
const envText = await readFile(join(backend, ".env.draft"), "utf8");
const env = Object.fromEntries(envText.split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
  const index = line.indexOf("=");
  return [line.slice(0, index), line.slice(index + 1)];
}));
const deployment = JSON.parse(await readFile(join(backend, "contracts/deployments/4663.json"), "utf8"));
const pool = deployment.poolV2;
const rootManager = deployment.poolV2RootManager;
const rpc = env.RPC_HTTP;
if (!pool || !rootManager || !env.OPERATOR_PRIVATE_KEY || !rpc || !env.UNISWAP_QUOTER_ADDR) {
  throw new Error("Missing Pool V2 deployment or operator RPC configuration.");
}

const chain = defineChain({
  id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const account = privateKeyToAccount(env.OPERATOR_PRIVATE_KEY);
const publicClient = createPublicClient({ chain, transport: http(rpc) });
const walletClient = createWalletClient({ account, chain, transport: http(rpc) });
const usd = deployment.tokens.USDG;
const nvda = deployment.tokens.NVDA;
const maxInput = 500_000n; // exactly the user's 0.5 USDG test allocation (USDG has 6 decimals)
const slippageBps = 100n;
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)", "function decimals() view returns(uint8)",
]);
const poolAbi = parseAbi([
  "function swapAndShield(address target,address tokenIn,uint256 amountIn,address tokenOut,uint256 minOut,bytes swapData,bytes32 commitment) returns(uint256)",
  "function unshield(bytes proof,bytes32 root,bytes32 nullifier,address token,uint256 amount,address recipient)",
  "function nullifierSpent(bytes32) view returns(bool)",
  "event NoteShielded(address indexed token,uint256 amount,bytes32 indexed commitment)",
]);
const managerAbi = parseAbi(["function publishRoot(bytes32 root)"]);
const quoterAbi = parseAbi([
  "struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactInputSingle(QuoteExactInputSingleParams params) returns(uint256 amountOut,uint160,uint32,uint256)",
]);
const routerAbi = parseAbi([
  "struct ExactOutputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountOut; uint256 amountInMaximum; uint160 sqrtPriceLimitX96; }",
  "function exactOutputSingle(ExactOutputSingleParams params) payable returns(uint256 amountIn)",
]);
const poseidon = await buildPoseidon();
const hash = (values) => poseidon.F.toObject(poseidon(values));
const formatHash = (value) => `0x${value.toString(16).padStart(64, "0")}`;
const randomSecret = () => {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return BigInt(`0x${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`) % poseidon.F.p;
};
const waitSuccess = async (hash) => {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
  return receipt;
};
const writeNote = async (path, value) => {
  const file = await open(path, "w", 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2)); } finally { await file.close(); }
};

const [decimals, startingUsd, startingNvda] = await Promise.all([
  publicClient.readContract({ address: usd, abi: erc20Abi, functionName: "decimals" }),
  publicClient.readContract({ address: usd, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
  publicClient.readContract({ address: nvda, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
]);
if (decimals !== 6 || startingUsd < maxInput) throw new Error("Operator wallet does not have the required 0.5 USDG test balance.");

const candidates = await Promise.all([100, 500, 3000, 10000].map(async (fee) => {
  try {
    const quote = await publicClient.simulateContract({
      address: env.UNISWAP_QUOTER_ADDR, abi: quoterAbi, functionName: "quoteExactInputSingle",
      args: [{ tokenIn: usd, tokenOut: nvda, amountIn: maxInput, fee, sqrtPriceLimitX96: 0n }],
    });
    return { fee, amountOut: quote.result[0] };
  } catch { return undefined; }
}));
const best = candidates.filter((value) => value && value.amountOut > 0n).sort((a, b) => a.amountOut > b.amountOut ? -1 : 1)[0];
if (!best) throw new Error("No live Uniswap V3 USDG/NVDA quote is available.");
const exactOutput = (best.amountOut * (10_000n - slippageBps)) / 10_000n;
const secret = randomSecret();
const commitment = formatHash(hash([secret, BigInt(nvda), exactOutput]));
const tokenInAllowance = await publicClient.readContract({ address: usd, abi: erc20Abi, functionName: "allowance", args: [account.address, pool] });
const noteDir = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "curtain-pool-v2-test-")));
const notePath = join(noteDir, "recovery-note.json");
const noteRecord = {
  network: "Robinhood Chain", pool, rootManager, commitment, secret: secret.toString(), token: nvda,
  amount: exactOutput.toString(), recipient: account.address, swapFee: best.fee,
  maxInput: maxInput.toString(), createdAt: new Date().toISOString(), status: "prepared",
};
const noteFile = await open(notePath, "wx", 0o600);
await noteFile.writeFile(JSON.stringify(noteRecord, null, 2));
await noteFile.close();

console.log(JSON.stringify({
  phase: "preflight", pool, rootManager, wallet: account.address, tokenIn: "USDG", tokenOut: "NVDA",
  maxInput: formatUnits(maxInput, decimals), fee: best.fee, quotedOutput: best.amountOut.toString(),
  shieldedOutput: exactOutput.toString(), recoveryNote: notePath,
}));

try {
  if (tokenInAllowance < maxInput) {
    const approval = await walletClient.writeContract({ address: usd, abi: erc20Abi, functionName: "approve", args: [pool, maxInput] });
    await waitSuccess(approval);
  }
  const swapData = encodeFunctionData({
    abi: routerAbi, functionName: "exactOutputSingle",
    args: [{ tokenIn: usd, tokenOut: nvda, fee: best.fee, recipient: pool, amountOut: exactOutput, amountInMaximum: maxInput, sqrtPriceLimitX96: 0n }],
  });
  const swapArgs = [deployment.router, usd, maxInput, nvda, exactOutput, swapData, commitment];
  // Simulate against the now-approved, live pool before broadcasting the swap.
  await publicClient.simulateContract({ account, address: pool, abi: poolAbi, functionName: "swapAndShield", args: swapArgs });
  const swapTx = await walletClient.writeContract({ address: pool, abi: poolAbi, functionName: "swapAndShield", args: swapArgs });
  noteRecord.status = "swap-submitted";
  noteRecord.swapTx = swapTx;
  const swapReceipt = await waitSuccess(swapTx);
  noteRecord.status = "shielded";
  await writeNote(notePath, noteRecord);
  const shieldEvent = swapReceipt.logs.map((log) => {
    try { return decodeEventLog({ abi: poolAbi, data: log.data, topics: log.topics }); } catch { return undefined; }
  }).find((event) => event?.eventName === "NoteShielded" && event.args.commitment.toLowerCase() === commitment.toLowerCase());
  if (!shieldEvent || shieldEvent.args.amount !== exactOutput) throw new Error("Swap mined, but exact shield amount/event validation failed.");

  // New pool is otherwise empty: the just-shielded commitment occupies leaf zero.
  const zeroHashes = [0n];
  for (let depth = 0; depth < 16; depth++) zeroHashes.push(hash([zeroHashes[depth], zeroHashes[depth]]));
  let root = BigInt(commitment);
  const siblings = [];
  for (let depth = 0; depth < 16; depth++) {
    siblings.push(formatHash(zeroHashes[depth]));
    root = hash([root, zeroHashes[depth]]);
  }
  const merkleRoot = formatHash(root);
  const rootTx = await walletClient.writeContract({ address: rootManager, abi: managerAbi, functionName: "publishRoot", args: [merkleRoot] });
  await waitSuccess(rootTx);
  noteRecord.status = "root-published";
  noteRecord.root = merkleRoot;
  noteRecord.rootTx = rootTx;
  await writeNote(notePath, noteRecord);

  const { proof, publicSignals } = await snarkjs.groth16.fullProve({
    secret: secret.toString(), tokenId: BigInt(nvda).toString(), amount: exactOutput.toString(),
    siblings, pathBits: Array(16).fill(0), recipient: BigInt(account.address).toString(),
  }, join(repo, "swap/public/pool-v4/pool_unshield.wasm"), join(repo, "swap/public/pool-v4/pool_unshield_production.zkey"));
  if (BigInt(publicSignals[0]) !== BigInt(merkleRoot) || BigInt(publicSignals[2]) !== BigInt(nvda) || BigInt(publicSignals[3]) !== exactOutput) {
    throw new Error("Generated unshield proof public signals do not match the test note.");
  }
  const a = proof.pi_a.slice(0, 2).map(BigInt);
  const b = [[BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])], [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])]];
  const c = proof.pi_c.slice(0, 2).map(BigInt);
  const proofBytes = encodeAbiParameters([
    { type: "uint256[2]" }, { type: "uint256[2][2]" }, { type: "uint256[2]" }, { type: "uint256[5]" },
  ], [a, b, c, publicSignals.map(BigInt)]);
  const nullifier = formatHash(BigInt(publicSignals[1]));
  const unshieldTx = await walletClient.writeContract({
    address: pool, abi: poolAbi, functionName: "unshield",
    args: [proofBytes, merkleRoot, nullifier, nvda, exactOutput, account.address],
  });
  await waitSuccess(unshieldTx);
  const [endingUsd, endingNvda, spent] = await Promise.all([
    publicClient.readContract({ address: usd, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
    publicClient.readContract({ address: nvda, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: "nullifierSpent", args: [nullifier] }),
  ]);
  if (endingNvda - startingNvda !== exactOutput || !spent) throw new Error("Unshield transaction mined but wallet delivery/spent-nullifier checks failed.");

  noteRecord.status = "complete";
  noteRecord.root = merkleRoot;
  noteRecord.rootTx = rootTx;
  noteRecord.unshieldTx = unshieldTx;
  await writeNote(notePath, noteRecord);
  const { unlink, rmdir } = await import("node:fs/promises");
  await unlink(notePath);
  await rmdir(noteDir);
  console.log(JSON.stringify({
    phase: "success", pool, wallet: account.address, swapTx, rootTx, unshieldTx,
    usdgSpent: formatUnits(startingUsd - endingUsd, decimals), nvdaDelivered: formatUnits(exactOutput, 18),
    recipientBalanceDelta: formatUnits(endingNvda - startingNvda, 18), nullifierSpent: spent,
  }));
  process.exit(0); // snarkjs may retain worker handles after fullProve completes.
} catch (error) {
  console.error(`Test stopped safely. Recovery note retained at: ${notePath}`);
  console.error(error);
  process.exit(1);
}
