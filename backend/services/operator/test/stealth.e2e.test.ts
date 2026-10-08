/**
 * Stealth payouts (FEATURE_STEALTH_PAYOUTS) end to end on Anvil + Deploy.s.sol: the sender pays
 * a one-time stealth address, the operator announces it and drops gas on it, and the receiver
 * finds the payment from the announcement alone and moves the tokens out with the stealth key.
 */
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { migrate, type Db } from "@curtain/db";
import { pgliteDb } from "@curtain/db/pglite";
import {
  STEALTH_ANNOUNCEMENT_EVENT,
  STEALTH_KEYS_MESSAGE,
  STEALTH_REGISTRY_ABI,
  matchAnnouncement,
  metaAddressBytes,
  stealthKeysFromSignature,
  computeStealthPrivateKey,
  encodeMetaAddress,
  generateStealthAddress,
  metaAddressFromKeys,
  parseMetaAddress,
  viewTagMatches,
} from "@curtain/sdk/stealth";
import { createWalletClient, http, parseAbi, parseEther, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { startDevnet, type Devnet } from "../../../scripts/devnet";
import { ERC20_ABI, VAULT_ABI } from "../src/abi";
import { createApi } from "../src/api";
import { Operator, STEALTH_ANNOUNCER_ABI } from "../src/operator";
import { mockQuoter, mockRoute } from "../src/routes";

setDefaultTimeout(240_000);

const MOCK = parseAbi([
  "function mint(address to, uint256 amount)",
  "function setRate(address tokenIn, address tokenOut, uint256 rateWad)",
]);
const TRANSFER = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);
// Only used to price the gas drop through the mock router (WETH -> USDG); never transferred.
const WETH = "0x000000000000000000000000000000000000e7e7" as Address;
const GAS_DROP = 20_000_000_000_000n; // 0.00002 ETH
const OVERHEAD = 5_000_000_000_000n;

let d: Devnet;
let db: Db;
let op: Operator;
let api: (req: Request) => Promise<Response>;
let plainApi: (req: Request) => Promise<Response>;
let chainNow = 0;
let usdg: Address;
let nvda: Address;
let announcer: Address;

const wait = async (hash: Hex) => {
  const r = await d.publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`tx reverted: ${hash}`);
  return r;
};
async function call(path: string, body?: unknown, handler = api) {
  chainNow = await d.now();
  const res = await handler(new Request(`http://op${path}`, body
    ? { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }
    : undefined));
  return { status: res.status, body: (await res.json()) as any };
}
const balance = (token: Address, who: Address) =>
  d.publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [who] });
async function syncUntil(done: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    await op.syncChain();
    if (await done()) return;
    await Bun.sleep(100);
  }
  throw new Error("condition never reached");
}

beforeAll(async () => {
  d = await startDevnet(8664);
  usdg = d.deployment.tokens["USDG"]!;
  nvda = d.deployment.tokens["NVDA"]!;
  announcer = (d.deployment as unknown as { stealthAnnouncer: Address }).stealthAnnouncer;
  const deployer = d.wallets.deployer;
  const tx = (address: Address, functionName: "mint" | "setRate", args: readonly unknown[]) =>
    deployer.writeContract({ chain: d.chain, account: deployer.account!, address, abi: MOCK, functionName, args: args as never }).then(wait);
  await tx(d.deployment.router, "setRate", [usdg, nvda, parseEther("0.005")]); // 200 USDG per NVDA
  await tx(d.deployment.router, "setRate", [WETH, usdg, parseEther("2700")]); // 2700 USDG per ETH
  await tx(nvda, "mint", [d.deployment.router, parseEther("1000")]);
  await tx(usdg, "mint", [d.wallets.user.account!.address, parseEther("100000")]);

  db = await pgliteDb();
  await migrate(db);
  const base = {
    db, publicClient: d.publicClient as never, walletClient: d.wallets.operator as never, chainId: 31337,
    vault: d.deployment.vault, router: d.deployment.router, route: mockRoute, quote: mockQuoter(d.publicClient, d.deployment.router),
    keeperFeeBps: 5, startBlock: await d.publicClient.getBlockNumber(),
  };
  op = new Operator({ ...base, stealth: { announcer, weth: WETH, usdg, gasDropWei: GAS_DROP, overheadWei: OVERHEAD } });
  api = createApi({ db, operator: op, vault: d.deployment.vault, tokens: d.deployment.tokens, keeperFeeBps: 5, now: () => chainNow });
  plainApi = createApi({ db, operator: new Operator(base), vault: d.deployment.vault, tokens: d.deployment.tokens, keeperFeeBps: 5, now: () => chainNow });
});

afterAll(() => d?.stop());

describe("stealth payouts (e2e)", () => {
  // Receiver: publishes only the meta-address; keeps both private keys.
  const spendKey = generatePrivateKey();
  const viewKey = generatePrivateKey();
  const metaText = encodeMetaAddress(metaAddressFromKeys(spendKey, viewKey));

  it("is off unless enabled: /config has no stealth block and stealth intents/quotes are refused", async () => {
    expect((await call("/config", undefined, plainApi)).body.stealth).toBeUndefined();
    const q = await call(`/quote?tokenIn=${usdg}&tokenOut=${nvda}&amountIn=${parseEther("10")}&stealth=1`, undefined, plainApi);
    expect(q.status).toBe(400);
    const pay = generateStealthAddress(parseMetaAddress(metaText));
    const r = await call("/intents", {
      tokenIn: usdg, amountIn: parseEther("10").toString(), tokenOut: nvda, recipient: pay.stealthAddress, minOut: "1", delaySeconds: 0,
      depositor: d.wallets.user.account!.address, stealth: { ephemeralPublicKey: pay.ephemeralPublicKey, viewTag: pay.viewTag },
    }, plainApi);
    expect(r.status).toBe(400);
    expect((await call("/config")).body.stealth).toEqual({ enabled: true, schemeId: 1, announcer, gasDropWei: GAS_DROP.toString() });
  });

  it("rejects malformed stealth data", async () => {
    const pay = generateStealthAddress(parseMetaAddress(metaText));
    const base = {
      tokenIn: usdg, amountIn: parseEther("10").toString(), tokenOut: nvda, recipient: pay.stealthAddress, minOut: "1", delaySeconds: 0,
      depositor: d.wallets.user.account!.address,
    };
    expect((await call("/intents", { ...base, stealth: { ephemeralPublicKey: `0x02${"00".repeat(32)}`, viewTag: pay.viewTag } })).status).toBe(400);
    expect((await call("/intents", { ...base, stealth: { ephemeralPublicKey: pay.ephemeralPublicKey, viewTag: "0x123" } })).status).toBe(400);
    expect((await call("/intents", { ...base, recipient: base.depositor, stealth: { ephemeralPublicKey: pay.ephemeralPublicKey, viewTag: pay.viewTag } })).status).toBe(400);
  });

  it("pays a stealth address, announces it from the operator, drops gas, and the receiver can spend it", async () => {
    // Sender: derives a fresh address from the receiver's meta-address in the browser.
    const pay = generateStealthAddress(parseMetaAddress(metaText));
    const amountIn = parseEther("1000");

    const quote = await call(`/quote?tokenIn=${usdg}&tokenOut=${nvda}&amountIn=${amountIn}&slippageBps=100&stealth=1`);
    expect(quote.status).toBe(200);
    const usd = ((GAS_DROP + OVERHEAD) * parseEther("2700")) / 10n ** 18n;
    const expectedFee = (((usd * parseEther("0.005")) / 10n ** 18n) * 12n) / 10n;
    expect(BigInt(quote.body.stealthFee)).toBe(expectedFee);
    const plain = await call(`/quote?tokenIn=${usdg}&tokenOut=${nvda}&amountIn=${amountIn}&slippageBps=100`);
    // The fee comes off before the 0.25% protocol + keeper fees, so the recipient loses slightly less than it.
    const lost = BigInt(plain.body.expectedOut) - BigInt(quote.body.expectedOut);
    expect(lost).toBeLessThanOrEqual(expectedFee);
    expect(lost).toBeGreaterThanOrEqual((expectedFee * 9975n) / 10000n);

    const user = d.wallets.user;
    const intent = await call("/intents", {
      tokenIn: usdg, amountIn: amountIn.toString(), tokenOut: nvda, recipient: pay.stealthAddress, minOut: quote.body.minOutSuggested,
      delaySeconds: 0, depositor: user.account!.address, stealth: { ephemeralPublicKey: pay.ephemeralPublicKey, viewTag: pay.viewTag },
    });
    expect(intent.status).toBe(201);
    await wait(await user.writeContract({ chain: d.chain, account: user.account!, address: usdg, abi: ERC20_ABI, functionName: "approve", args: [d.deployment.vault, amountIn] }));
    await wait(await user.writeContract({
      chain: d.chain, account: user.account!, address: d.deployment.vault, abi: VAULT_ABI, functionName: "deposit", args: [usdg, amountIn, intent.body.deadlineHash],
    }));
    await syncUntil(async () => (await call(`/intents/${intent.body.id}`)).body.status === "deposited");

    const opAddr = d.wallets.operator.account!.address;
    const opNvdaBefore = await balance(nvda, opAddr);
    await op.processDue(await d.now());
    await op.submitSettlements(await d.now());
    await syncUntil(async () => (await call(`/intents/${intent.body.id}`)).body.status === "paid");

    const total = (parseEther("5") * 9950n) / 10000n;
    const gross = total - expectedFee;
    const protocolFee = (gross * 20n) / 10000n;
    const keeperFee = (gross * 5n) / 10000n;
    const amount = gross - protocolFee - keeperFee;
    // V2 vault: the swap's surplus over the signed minimum is shared pro rata over the
    // payouts' amounts (the recipient's and the gas-drop fee payout's).
    const surplus = parseEther("5") - total;
    const userTotal = amount + expectedFee;
    expect(await balance(nvda, pay.stealthAddress)).toBe(amount + (surplus * amount) / userTotal);
    expect(await balance(nvda, pay.stealthAddress)).toBeGreaterThanOrEqual(BigInt(quote.body.minOutSuggested));
    // The operator was its own keeper here, so it also earned the keeper fee.
    expect((await balance(nvda, opAddr)) - opNvdaBefore).toBe(expectedFee + (surplus * expectedFee) / userTotal + keeperFee);

    // Follow-up: announcement + gas drop, exactly once even if run again.
    expect(await op.processStealth()).toBe(1);
    expect(await op.processStealth()).toBe(0);
    expect(await d.publicClient.getBalance({ address: pay.stealthAddress })).toBe(GAS_DROP);
    const announcements = await d.publicClient.getContractEvents({ address: announcer, abi: STEALTH_ANNOUNCER_ABI, eventName: "Announcement", fromBlock: 0n });
    const mine = announcements.filter((a) => a.args.stealthAddress === pay.stealthAddress);
    expect(mine.length).toBe(1);
    expect(mine[0]!.args.caller).toBe(opAddr); // not the depositor: nothing links them on-chain
    expect(mine[0]!.args.caller).not.toBe(user.account!.address);

    // Receiver: scans announcements with the viewing key, derives the spending key, moves the tokens.
    const found = announcements.filter((a) => viewTagMatches(viewKey, a.args.ephemeralPubKey!, a.args.metadata!.slice(0, 4) as Hex));
    const hit = found.find((a) => privateKeyToAccount(computeStealthPrivateKey(spendKey, viewKey, a.args.ephemeralPubKey!)).address === a.args.stealthAddress);
    expect(hit?.args.stealthAddress).toBe(pay.stealthAddress);
    const stealthAccount = privateKeyToAccount(computeStealthPrivateKey(spendKey, viewKey, hit!.args.ephemeralPubKey!));
    const stealthWallet = createWalletClient({ account: stealthAccount, chain: d.chain, transport: http(d.rpcUrl) });
    const sweepTo = privateKeyToAccount(generatePrivateKey()).address;
    const held = await balance(nvda, pay.stealthAddress);
    // At Robinhood Chain's ~0.02 gwei (Anvil defaults to ~1 gwei), the dropped gas pays for the sweep.
    await d.testClient.setNextBlockBaseFeePerGas({ baseFeePerGas: 20_000_000n });
    await wait(await stealthWallet.writeContract({
      chain: d.chain, account: stealthAccount, address: nvda, abi: TRANSFER, functionName: "transfer", args: [sweepTo, held],
      maxFeePerGas: 40_000_000n, maxPriorityFeePerGas: 0n,
    }));
    expect(await balance(nvda, sweepTo)).toBe(held);

    const st = await call("/status");
    expect(st.body.problems.some((p: string) => p.includes("stealth"))).toBe(false);
  });

  it("a paid stealth deposit still can't be refunded: the payout tag challenges it", async () => {
    const pay = generateStealthAddress(parseMetaAddress(metaText));
    const amountIn = parseEther("100");
    const quote = await call(`/quote?tokenIn=${usdg}&tokenOut=${nvda}&amountIn=${amountIn}&stealth=1`);
    const user = d.wallets.user;
    const intent = await call("/intents", {
      tokenIn: usdg, amountIn: amountIn.toString(), tokenOut: nvda, recipient: pay.stealthAddress, minOut: quote.body.minOutSuggested,
      delaySeconds: 0, depositor: user.account!.address, stealth: { ephemeralPublicKey: pay.ephemeralPublicKey, viewTag: pay.viewTag },
    });
    await wait(await user.writeContract({ chain: d.chain, account: user.account!, address: usdg, abi: ERC20_ABI, functionName: "approve", args: [d.deployment.vault, amountIn] }));
    await wait(await user.writeContract({
      chain: d.chain, account: user.account!, address: d.deployment.vault, abi: VAULT_ABI, functionName: "deposit", args: [usdg, amountIn, intent.body.deadlineHash],
    }));
    await syncUntil(async () => (await call(`/intents/${intent.body.id}`)).body.status === "deposited");
    await op.processDue(await d.now());
    await op.submitSettlements(await d.now());
    await syncUntil(async () => (await call(`/intents/${intent.body.id}`)).body.status === "paid");
    const { depositId } = (await call(`/intents/${intent.body.id}`)).body;

    await d.testClient.increaseTime({ seconds: 600 + 181 });
    await d.testClient.mine({ blocks: 1 });
    await wait(await user.writeContract({
      chain: d.chain, account: user.account!, address: d.deployment.vault, abi: VAULT_ABI, functionName: "requestRefund",
      args: [BigInt(depositId), BigInt(intent.body.deadline), intent.body.salt],
    }));
    await syncUntil(async () => (await call(`/intents/${intent.body.id}`)).body.status === "challenged");
  });

  it("receiver flow: keys from a signature, published to the registry, found by the inbox scan, withdrawn", async () => {
    // #3: the receiver signs, derives keys, and publishes the meta-address under their wallet.
    const receiverWallet = d.wallets.keeper; // any funded wallet
    const sig = await receiverWallet.signMessage({ account: receiverWallet.account!, message: STEALTH_KEYS_MESSAGE });
    expect(await receiverWallet.signMessage({ account: receiverWallet.account!, message: STEALTH_KEYS_MESSAGE })).toBe(sig);
    const keys = stealthKeysFromSignature(sig);
    const registry = (d.deployment as unknown as { stealthRegistry: Address }).stealthRegistry;
    await wait(await receiverWallet.writeContract({
      chain: d.chain, account: receiverWallet.account!, address: registry, abi: STEALTH_REGISTRY_ABI, functionName: "registerKeys", args: [1n, metaAddressBytes(keys.meta)],
    }));

    // #1: the sender only knows the receiver's wallet address and looks the keys up.
    const raw = await d.publicClient.readContract({ address: registry, abi: STEALTH_REGISTRY_ABI, functionName: "stealthMetaAddressOf", args: [receiverWallet.account!.address, 1n] });
    const pay = generateStealthAddress(parseMetaAddress(raw));
    const amountIn = parseEther("200");
    const quote = await call(`/quote?tokenIn=${usdg}&tokenOut=${nvda}&amountIn=${amountIn}&stealth=1`);
    const user = d.wallets.user;
    const intent = await call("/intents", {
      tokenIn: usdg, amountIn: amountIn.toString(), tokenOut: nvda, recipient: pay.stealthAddress, minOut: quote.body.minOutSuggested,
      delaySeconds: 0, depositor: user.account!.address, stealth: { ephemeralPublicKey: pay.ephemeralPublicKey, viewTag: pay.viewTag },
    });
    await wait(await user.writeContract({ chain: d.chain, account: user.account!, address: usdg, abi: ERC20_ABI, functionName: "approve", args: [d.deployment.vault, amountIn] }));
    await wait(await user.writeContract({
      chain: d.chain, account: user.account!, address: d.deployment.vault, abi: VAULT_ABI, functionName: "deposit", args: [usdg, amountIn, intent.body.deadlineHash],
    }));
    await syncUntil(async () => (await call(`/intents/${intent.body.id}`)).body.status === "deposited");
    await op.processDue(await d.now());
    await op.submitSettlements(await d.now());
    await syncUntil(async () => (await call(`/intents/${intent.body.id}`)).body.status === "paid");
    await op.processStealth();

    // #2: the inbox scan, exactly as the browser does it.
    const anns = await d.publicClient.getLogs({ address: announcer, event: STEALTH_ANNOUNCEMENT_EVENT, args: { schemeId: 1n }, fromBlock: 0n });
    const mine = anns.flatMap((a) => {
      const key = matchAnnouncement(keys, { stealthAddress: a.args.stealthAddress!, ephemeralPubKey: a.args.ephemeralPubKey!, metadata: a.args.metadata! });
      return key ? [{ address: a.args.stealthAddress!, key }] : [];
    });
    expect(mine.map((m) => m.address)).toEqual([pay.stealthAddress]); // earlier tests' payments aren't ours
    const paid = await d.publicClient.getContractEvents({ address: d.deployment.vault, abi: VAULT_ABI, eventName: "PaidOut", args: { recipient: [pay.stealthAddress] }, fromBlock: 0n });
    expect(paid.length).toBe(1);
    expect(paid[0]!.args.token).toBe(nvda);

    const account = privateKeyToAccount(mine[0]!.key);
    const stealthWallet = createWalletClient({ account, chain: d.chain, transport: http(d.rpcUrl) });
    const fresh = privateKeyToAccount(generatePrivateKey()).address;
    const held = await balance(nvda, pay.stealthAddress);
    expect(held).toBeGreaterThan(0n);
    await d.testClient.setNextBlockBaseFeePerGas({ baseFeePerGas: 20_000_000n });
    await wait(await stealthWallet.writeContract({
      chain: d.chain, account, address: nvda, abi: TRANSFER, functionName: "transfer", args: [fresh, held], maxFeePerGas: 40_000_000n, maxPriorityFeePerGas: 0n,
    }));
    expect(await balance(nvda, fresh)).toBe(held);
    expect(await balance(nvda, pay.stealthAddress)).toBe(0n);
  });
});
