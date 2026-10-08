/**
 * Split payouts (FEATURE_SPLIT_PAYOUTS) end to end on Anvil + Deploy.s.sol: one deposit paid to
 * several recipients in one settlement, with and without stealth recipients, and the refund
 * protection still holding.
 */
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { migrate, type Db } from "@curtain/db";
import { pgliteDb } from "@curtain/db/pglite";
import { generateStealthAddress, metaAddressFromKeys } from "@curtain/sdk/stealth";
import { parseAbi, parseEther, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { startDevnet, type Devnet } from "../../../scripts/devnet";
import { ERC20_ABI, VAULT_ABI } from "../src/abi";
import { createApi } from "../src/api";
import { Operator } from "../src/operator";
import { mockQuoter, mockRoute } from "../src/routes";

setDefaultTimeout(240_000);

const MOCK = parseAbi([
  "function mint(address to, uint256 amount)",
  "function setRate(address tokenIn, address tokenOut, uint256 rateWad)",
]);
const WETH = "0x000000000000000000000000000000000000e7e7" as Address;
const GAS_DROP = 20_000_000_000_000n;

let d: Devnet;
let db: Db;
let op: Operator;
let api: (req: Request) => Promise<Response>;
let plainApi: (req: Request) => Promise<Response>;
let chainNow = 0;
let usdg: Address;
let nvda: Address;

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
const fresh = () => privateKeyToAccount(generatePrivateKey()).address;

/** Creates the intent, deposits, settles through the operator's own keeper, waits for "paid". */
async function swapAndSettle(body: Record<string, unknown>, amountIn: bigint) {
  const user = d.wallets.user;
  const intent = await call("/intents", { tokenIn: usdg, amountIn: amountIn.toString(), tokenOut: nvda, delaySeconds: 0, depositor: user.account!.address, ...body });
  expect(intent.status).toBe(201);
  await wait(await user.writeContract({ chain: d.chain, account: user.account!, address: usdg, abi: ERC20_ABI, functionName: "approve", args: [d.deployment.vault, amountIn] }));
  await wait(await user.writeContract({
    chain: d.chain, account: user.account!, address: d.deployment.vault, abi: VAULT_ABI, functionName: "deposit", args: [usdg, amountIn, intent.body.deadlineHash],
  }));
  await syncUntil(async () => (await call(`/intents/${intent.body.id}`)).body.status === "deposited");
  await op.processDue(await d.now());
  await op.submitSettlements(await d.now());
  await syncUntil(async () => (await call(`/intents/${intent.body.id}`)).body.status === "paid");
  return intent.body;
}

beforeAll(async () => {
  d = await startDevnet(8665);
  usdg = d.deployment.tokens["USDG"]!;
  nvda = d.deployment.tokens["NVDA"]!;
  const deployer = d.wallets.deployer;
  const tx = (address: Address, functionName: "mint" | "setRate", args: readonly unknown[]) =>
    deployer.writeContract({ chain: d.chain, account: deployer.account!, address, abi: MOCK, functionName, args: args as never }).then(wait);
  await tx(d.deployment.router, "setRate", [usdg, nvda, parseEther("0.005")]);
  await tx(d.deployment.router, "setRate", [WETH, usdg, parseEther("2700")]);
  await tx(nvda, "mint", [d.deployment.router, parseEther("1000")]);
  await tx(usdg, "mint", [d.wallets.user.account!.address, parseEther("100000")]);

  db = await pgliteDb();
  await migrate(db);
  const announcer = (d.deployment as unknown as { stealthAnnouncer: Address }).stealthAnnouncer;
  const base = {
    db, publicClient: d.publicClient as never, walletClient: d.wallets.operator as never, chainId: 31337,
    vault: d.deployment.vault, router: d.deployment.router, route: mockRoute, quote: mockQuoter(d.publicClient, d.deployment.router),
    keeperFeeBps: 5, startBlock: await d.publicClient.getBlockNumber(),
  };
  op = new Operator({ ...base, splitPayouts: true, stealth: { announcer, weth: WETH, usdg, gasDropWei: GAS_DROP, overheadWei: 5_000_000_000_000n } });
  api = createApi({ db, operator: op, vault: d.deployment.vault, tokens: d.deployment.tokens, keeperFeeBps: 5, now: () => chainNow });
  plainApi = createApi({ db, operator: new Operator(base), vault: d.deployment.vault, tokens: d.deployment.tokens, keeperFeeBps: 5, now: () => chainNow });
});

afterAll(() => d?.stop());

describe("split payouts (e2e)", () => {
  it("is off unless enabled, and validates recipients", async () => {
    expect((await call("/config", undefined, plainApi)).body.split).toBeUndefined();
    expect((await call("/config")).body.split).toEqual({ enabled: true, maxRecipients: 5 });
    expect((await call(`/quote?tokenIn=${usdg}&tokenOut=${nvda}&amountIn=${parseEther("10")}&splits=3`, undefined, plainApi)).status).toBe(400);
    const a = fresh(), b = fresh();
    const base = { tokenIn: usdg, amountIn: parseEther("10").toString(), tokenOut: nvda, minOut: "1000", delaySeconds: 0, depositor: d.wallets.user.account!.address };
    expect((await call("/intents", { ...base, recipient: a, splits: [{ recipient: a }, { recipient: b }] }, plainApi)).status).toBe(400);
    expect((await call("/intents", { ...base, recipient: a, splits: [{ recipient: a }] })).status).toBe(400); // only one
    expect((await call("/intents", { ...base, recipient: a, splits: [a, b, fresh(), fresh(), fresh(), fresh()].map((r) => ({ recipient: r })) })).status).toBe(400); // six
    expect((await call("/intents", { ...base, recipient: a, splits: [{ recipient: a }, { recipient: a.toLowerCase() }] })).status).toBe(400); // duplicate
    expect((await call("/intents", { ...base, recipient: b, splits: [{ recipient: a }, { recipient: b }] })).status).toBe(400); // recipient != first
    expect((await call("/intents", { ...base, recipient: a, splits: [{ recipient: a }, { recipient: d.deployment.vault }] })).status).toBe(400); // vault
    expect((await call("/intents", { ...base, minOut: "1", recipient: a, splits: [{ recipient: a }, { recipient: b }] })).status).toBe(400); // too small
  });

  it("pays three recipients in random shares from one deposit, in one settlement", async () => {
    const recipients = [fresh(), fresh(), fresh()];
    const amountIn = parseEther("1000");
    const quote = await call(`/quote?tokenIn=${usdg}&tokenOut=${nvda}&amountIn=${amountIn}&splits=3&splitMode=random`);
    expect(quote.status).toBe(200);
    expect(quote.body.splitParts).toBe(3);
    const intent = await swapAndSettle({ recipient: recipients[0], minOut: quote.body.minOutSuggested, splits: recipients.map((r) => ({ recipient: r })), splitMode: "random" }, amountIn);
    expect(intent.splits.map((sp: { recipient: string }) => sp.recipient)).toEqual(recipients);
    expect(intent.splits.reduce((s: number, sp: { shareBps: number }) => s + sp.shareBps, 0)).toBe(10_000);

    const gross = (parseEther("5") * 9950n) / 10000n;
    const got = await Promise.all(recipients.map((r) => balance(nvda, r)));
    const total = got.reduce((a, b) => a + b, 0n);
    // Fees are charged per part, so the total matches a single payout to within rounding, plus
    // the swap's surplus over the signed minimum, which the V2 vault shares out to recipients.
    const single = gross - (gross * 20n) / 10000n - (gross * 5n) / 10000n + (parseEther("5") - gross);
    expect(single - total).toBeGreaterThanOrEqual(0n);
    expect(single - total).toBeLessThan(10n);
    expect(total).toBeGreaterThanOrEqual(BigInt(quote.body.minOutSuggested));
    for (const [k, sp] of (intent.splits as { shareBps: number }[]).entries()) {
      const expected = (single * BigInt(sp.shareBps)) / 10000n;
      expect(got[k]! - expected < 10n && expected - got[k]! < 10n).toBe(true);
      expect(got[k]!).toBeGreaterThan(0n);
    }
    // Three distinct, non-round amounts.
    expect(new Set(got.map(String)).size).toBe(3);
  });

  it("equal shares split evenly", async () => {
    const recipients = [fresh(), fresh()];
    const quote = await call(`/quote?tokenIn=${usdg}&tokenOut=${nvda}&amountIn=${parseEther("200")}&splits=2&splitMode=equal`);
    const intent = await swapAndSettle({ recipient: recipients[0], minOut: quote.body.minOutSuggested, splits: recipients.map((r) => ({ recipient: r })), splitMode: "equal" }, parseEther("200"));
    expect(intent.splits.map((sp: { shareBps: number }) => sp.shareBps)).toEqual([5000, 5000]);
    const [x, y] = await Promise.all(recipients.map((r) => balance(nvda, r)));
    expect(x! - y! < 3n && y! - x! < 3n).toBe(true);
  });

  it("splits across stealth addresses: each gets its own announcement and gas drop", async () => {
    const meta = metaAddressFromKeys(generatePrivateKey(), generatePrivateKey());
    const pays = [generateStealthAddress(meta), generateStealthAddress(meta)];
    const amountIn = parseEther("500");
    const quote = await call(`/quote?tokenIn=${usdg}&tokenOut=${nvda}&amountIn=${amountIn}&stealth=1&splits=2`);
    expect(quote.status).toBe(200);
    const fee = BigInt(quote.body.stealthFee);
    const plain = await call(`/quote?tokenIn=${usdg}&tokenOut=${nvda}&amountIn=${amountIn}&splits=2`);
    const lost = BigInt(plain.body.expectedOut) - BigInt(quote.body.expectedOut);
    expect(lost).toBeLessThanOrEqual(2n * fee); // one stealth fee per recipient
    expect(lost).toBeGreaterThan(fee);

    const opAddr = d.wallets.operator.account!.address;
    const before = await balance(nvda, opAddr);
    await swapAndSettle({
      recipient: pays[0]!.stealthAddress, minOut: quote.body.minOutSuggested,
      splits: pays.map((p) => ({ recipient: p.stealthAddress, stealth: { ephemeralPublicKey: p.ephemeralPublicKey, viewTag: p.viewTag } })),
    }, amountIn);
    const got = await Promise.all(pays.map((p) => balance(nvda, p.stealthAddress)));
    expect(got[0]!).toBeGreaterThan(0n);
    expect(got[1]!).toBeGreaterThan(0n);
    expect(got[0]! + got[1]!).toBeGreaterThanOrEqual(BigInt(quote.body.minOutSuggested));
    expect((await balance(nvda, opAddr)) - before).toBeGreaterThanOrEqual(2n * fee); // two fee payouts (+ keeper fee)

    expect(await op.processStealth()).toBe(2);
    expect(await op.processStealth()).toBe(0);
    for (const p of pays) expect(await d.publicClient.getBalance({ address: p.stealthAddress })).toBe(GAS_DROP);
    const st = await call("/status");
    expect(st.body.problems.some((x: string) => x.includes("stealth"))).toBe(false);
  });

  it("a paid split deposit still can't be refunded: part 0 carries the challenge tag", async () => {
    const recipients = [fresh(), fresh(), fresh()];
    const quote = await call(`/quote?tokenIn=${usdg}&tokenOut=${nvda}&amountIn=${parseEther("100")}&splits=3`);
    const intent = await swapAndSettle({ recipient: recipients[0], minOut: quote.body.minOutSuggested, splits: recipients.map((r) => ({ recipient: r })) }, parseEther("100"));
    const { depositId } = (await call(`/intents/${intent.id}`)).body;
    await d.testClient.increaseTime({ seconds: 600 + 181 });
    await d.testClient.mine({ blocks: 1 });
    const user = d.wallets.user;
    await wait(await user.writeContract({
      chain: d.chain, account: user.account!, address: d.deployment.vault, abi: VAULT_ABI, functionName: "requestRefund",
      args: [BigInt(depositId), BigInt(intent.deadline), intent.salt],
    }));
    await syncUntil(async () => (await call(`/intents/${intent.id}`)).body.status === "challenged");
  });
});
