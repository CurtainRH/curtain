/**
 * Operator process. Env:
 *   DATABASE_URL, RPC_HTTP, CHAIN_ID
 *   OPERATOR_PRIVATE_KEY   the vault's operator key (signs payouts, runs swaps)
 *   VAULT_ADDR, DEX_ROUTER_ADDR
 *   TOKENS                 JSON {"USDG":"0x...","NVDA":"0x...",...}
 *   UNISWAP_QUOTER_ADDR    v3 QuoterV2 (required for uniswap); every fee tier is quoted
 *   V4_ADAPTER_ADDR        UniswapV4Adapter from the deployment (optional: enables v4 routing)
 *   V4_QUOTER_ADDR         Uniswap V4Quoter (with V4_ADAPTER_ADDR)
 *   ROUTE                  "uniswap" (default: best of v3 and v4) or "mock" (local chains)
 *   SLIPPAGE_BPS           default 50
 *   KEEPER_FEE_BPS         default 5
 *   PORT / OPERATOR_PORT   listen port (Render sets PORT), default 3100
 *   MIN_OPERATOR_BALANCE_WEI  /status warns below this gas balance, default 0.005 ETH
 *   TICK_MS                default 5000
 *   START_BLOCK            first block to index (default: current head on first run)
 *
 *   FEATURE_STEALTH_PAYOUTS   "true" turns on stealth payouts (ERC-5564); anything else = off
 *   STEALTH_ANNOUNCER_ADDR    ERC-5564 announcer (required when stealth payouts are on)
 *   STEALTH_GAS_DROP_WEI      ETH dropped on each stealth address, default 20000000000000 (0.00002 ETH)
 *   STEALTH_OVERHEAD_WEI      operator gas per stealth payout, charged in the fee, default 5000000000000
 *   WETH_ADDR                 optional; default: the router's WETH9()
 *   FEATURE_SPLIT_PAYOUTS     "true" lets one swap pay 2-5 recipients; anything else = off
 *   FEATURE_ANONYMITY_SET     "true" serves GET /pool (deposits waiting, per token); anything else = off
 */
import { bunSqlDb, migrate } from "@curtain/db";
import { DEFAULT_TOKENS } from "@curtain/sdk";
import { createPublicClient, createWalletClient, defineChain, getAddress, http, isAddress, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createApi } from "./api";
import { Operator, type StealthConfig } from "./operator";
import { mockQuoter, mockRoute, uniswapQuoter, uniswapRoute } from "./routes";

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`${k} is not set`);
  return v;
};

function parseTokens(raw?: string): Record<string, Address> {
  if (!raw || !raw.trim()) {
    console.log("No TOKENS env provided, using default Robinhood Chain token registry (45 tokens).");
    return DEFAULT_TOKENS;
  }
  let s = raw.trim();
  // Strip outer quotes if Render or shell wrapped the entire string
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    s = s.slice(1, -1).trim();
  }
  if (s.includes('\\"')) {
    try {
      const unescaped = JSON.parse(`"${s}"`);
      if (typeof unescaped === "string") s = unescaped;
    } catch {}
  }
  try {
    return JSON.parse(s);
  } catch (err) {
    try {
      const fixed = s
        .replace(/([{,]\s*)([a-zA-Z0-9_$-]+)\s*:/g, '$1"$2":')
        .replace(/'/g, '"');
      return JSON.parse(fixed);
    } catch {
      try {
        const fn = new Function(`return (${s})`);
        const res = fn();
        if (typeof res === "object" && res !== null) return res as Record<string, Address>;
      } catch {}
      console.warn("Failed to parse TOKENS env (likely truncated in UI). Falling back to default token registry. Raw value received:\n", raw);
      return DEFAULT_TOKENS;
    }
  }
}

const chainId = Number(env("CHAIN_ID", "4663"));
const chain = defineChain({
  id: chainId, name: "rhc", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [env("RPC_HTTP")] } },
});
const publicClient = createPublicClient({ chain, transport: http() });
const walletClient = createWalletClient({ account: privateKeyToAccount(env("OPERATOR_PRIVATE_KEY") as Hex), chain, transport: http() });
const db = await bunSqlDb();
await migrate(db);

const vault = env("VAULT_ADDR") as Address;
const router = env("DEX_ROUTER_ADDR") as Address;
const keeperFeeBps = Number(env("KEEPER_FEE_BPS", "5"));
const tokens = parseTokens(process.env["TOKENS"]);

/** Stealth payouts are off unless the flag is exactly "true"; when on, misconfiguration stops startup. */
async function stealthConfig(): Promise<StealthConfig | undefined> {
  if (process.env["FEATURE_STEALTH_PAYOUTS"]?.trim().toLowerCase() !== "true") return undefined;
  const announcer = env("STEALTH_ANNOUNCER_ADDR").trim();
  if (!isAddress(announcer)) throw new Error("STEALTH_ANNOUNCER_ADDR is not an address");
  if (!(await publicClient.getCode({ address: announcer }))) throw new Error(`no contract at STEALTH_ANNOUNCER_ADDR ${announcer}`);
  const wethEnv = process.env["WETH_ADDR"]?.trim();
  const weth = wethEnv
    ? (isAddress(wethEnv) ? getAddress(wethEnv) : (() => { throw new Error("WETH_ADDR is not an address"); })())
    : await publicClient.readContract({ address: router, abi: parseAbi(["function WETH9() view returns (address)"]), functionName: "WETH9" });
  const usdg = Object.entries(tokens).find(([symbol]) => symbol.toUpperCase() === "USDG")?.[1];
  const gasDropWei = BigInt(env("STEALTH_GAS_DROP_WEI", "20000000000000"));
  const overheadWei = BigInt(env("STEALTH_OVERHEAD_WEI", "5000000000000"));
  if (gasDropWei <= 0n || gasDropWei > 1_000_000_000_000_000n) throw new Error("STEALTH_GAS_DROP_WEI must be between 1 wei and 0.001 ETH");
  if (overheadWei < 0n) throw new Error("STEALTH_OVERHEAD_WEI can't be negative");
  console.log(`stealth payouts ON: announcer ${announcer}, gas drop ${gasDropWei} wei`);
  return { announcer: getAddress(announcer), weth: getAddress(weth), ...(usdg && isAddress(usdg) ? { usdg: getAddress(usdg) } : {}), gasDropWei, overheadWei };
}
const stealth = await stealthConfig();
const mock = env("ROUTE", "uniswap") === "mock";
const operator = new Operator({
  db, publicClient, walletClient, chainId, vault, router,
  route: mock ? mockRoute : uniswapRoute(),
  quote: mock ? mockQuoter(publicClient, router) : uniswapQuoter({
    client: publicClient, v3Router: router, v3Quoter: env("UNISWAP_QUOTER_ADDR") as Address,
    v4Adapter: process.env["V4_ADAPTER_ADDR"] as Address | undefined, v4Quoter: process.env["V4_QUOTER_ADDR"] as Address | undefined,
  }),
  slippageBps: Number(env("SLIPPAGE_BPS", "50")),
  keeperFeeBps,
  startBlock: process.env["START_BLOCK"] ? BigInt(process.env["START_BLOCK"]) : await publicClient.getBlockNumber(),
  ...(stealth ? { stealth } : {}),
  splitPayouts: process.env["FEATURE_SPLIT_PAYOUTS"]?.trim().toLowerCase() === "true",
  anonymitySet: process.env["FEATURE_ANONYMITY_SET"]?.trim().toLowerCase() === "true",
});
if (operator.splitEnabled) console.log("split payouts ON");

const server = Bun.serve({
  port: Number(process.env["PORT"] ?? env("OPERATOR_PORT", "3100")),
  fetch: createApi({
    db, operator, vault, tokens, keeperFeeBps,
    minBalanceWei: BigInt(env("MIN_OPERATOR_BALANCE_WEI", "5000000000000000")),
  }),
});
console.log(`@curtain/operator listening on :${server.port}`);

const tickMs = Number(env("TICK_MS", "5000"));
for (;;) {
  const started = Date.now();
  const now = Math.floor(started / 1000);
  try {
    await operator.syncChain();
    await operator.cleanupExpiredIntents();
    await operator.processDue(now);
    await operator.submitSettlements(now);
    await operator.syncChain();
    await operator.processStealth();
    operator.markTick();
  } catch (e) {
    console.error("operator tick failed:", e instanceof Error ? e.message.split("\n")[0] : e);
  }
  await Bun.sleep(Math.max(0, tickMs - (Date.now() - started)));
}
