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
 *   FEATURE_TICKET_SYNC       "true" serves GET/PUT /sync/:id (encrypted ticket backups); anything else = off
 *   FEATURE_POOL_V2_ROUTE      "true" enables product V4 quote/root APIs; defaults off
 *   POOL_V2_ADDR               active deployed CurtainPoolV2 address
 *   POOL_V2_ROOT_MANAGER_ADDR  active PoolV2RootManager address
 *   POOL_V2_START_BLOCK        first block to scan for Pool V2 NoteShielded events
 *   POOL_V2_LEGACY_ADDR        optional prior pool retained for recovery witness lookup
 *   POOL_V2_LEGACY_ROOT_MANAGER_ADDR  prior pool's root manager
 *   POOL_V2_LEGACY_START_BLOCK first block to scan for legacy note recovery
 *                              (POOL_V4_* aliases remain temporarily compatible)
 */
import { bunSqlDb, migrate } from "@curtain/db";
import { DEFAULT_TOKENS } from "@curtain/sdk";
import { createPublicClient, createWalletClient, defineChain, getAddress, http, isAddress, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createApi } from "./api";
import { createMcpApi } from "./mcp";
import { Operator, type StealthConfig } from "./operator";
import { mockQuoter, mockRoute, uniswapQuoter, uniswapRoute } from "./routes";
import { PoolV2RootPublisher } from "./poolV2";

// Product V4 stays opt-in until the operator configuration and frontend rollout are ready.
const POOL_V2_PRODUCT_ROUTE_ENABLED = process.env["FEATURE_POOL_V2_ROUTE"]?.trim().toLowerCase() === "true";

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
const poolV2 = process.env["POOL_V2_ADDR"] ?? process.env["POOL_V4_ADDR"];
const poolV2RootManager = process.env["POOL_V2_ROOT_MANAGER_ADDR"] ?? process.env["POOL_V4_ROOT_MANAGER_ADDR"];
const poolV2StartBlock = process.env["POOL_V2_START_BLOCK"] ?? process.env["POOL_V4_START_BLOCK"];
const poolV2Address = poolV2 ? getAddress(poolV2 as Address) : undefined;
const poolV2ManagerAddress = poolV2RootManager ? getAddress(poolV2RootManager as Address) : undefined;
const poolV2Publisher = POOL_V2_PRODUCT_ROUTE_ENABLED && poolV2Address && poolV2ManagerAddress
  ? new PoolV2RootPublisher({
      db, publicClient, walletClient, pool: poolV2Address, rootManager: poolV2ManagerAddress,
      startBlock: poolV2StartBlock ? BigInt(poolV2StartBlock) : await publicClient.getBlockNumber(),
    })
  : undefined;
if (poolV2Publisher) console.log(`Pool V2 root publisher ON for product V4: ${poolV2Address}`);
else if (poolV2Address || poolV2ManagerAddress) console.log("Product V4 route is paused; Pool V2 publisher is disabled.");
const poolV2LegacyAddress = process.env["POOL_V2_LEGACY_ADDR"] ? getAddress(process.env["POOL_V2_LEGACY_ADDR"] as Address) : undefined;
const poolV2LegacyManagerAddress = process.env["POOL_V2_LEGACY_ROOT_MANAGER_ADDR"]
  ? getAddress(process.env["POOL_V2_LEGACY_ROOT_MANAGER_ADDR"] as Address)
  : undefined;
const poolV2LegacyPublisher = poolV2LegacyAddress && poolV2LegacyManagerAddress
  ? new PoolV2RootPublisher({
      db, publicClient, walletClient, pool: poolV2LegacyAddress, rootManager: poolV2LegacyManagerAddress,
      startBlock: process.env["POOL_V2_LEGACY_START_BLOCK"] ? BigInt(process.env["POOL_V2_LEGACY_START_BLOCK"]) : 84199146n,
    })
  : undefined;
if (poolV2LegacyPublisher) console.log(`Pool V2 legacy recovery indexer ON for ${poolV2LegacyAddress}`);

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
const makeFixedAmounts = async () => {
  const result = new Set<string>();
  const raw = env("V3_FIXED_AMOUNTS_JSON");
  if (raw.trim().toLowerCase() === "default") {
    for (const [symbol, token] of Object.entries(tokens)) {
      const decimals = await publicClient.readContract({ address: getAddress(token), abi: parseAbi(["function decimals() view returns (uint8)"]), functionName: "decimals" });
      const unit = 10n ** BigInt(decimals);
      const base = symbol.toUpperCase() === "USDG" ? 10n : 1n;
      const multipliers = symbol.toUpperCase() === "USDG" ? [1n, 10n, 100n, 1000n] : [1n, 10n, 100n];
      for (const multiplier of multipliers) result.add(`${getAddress(token)}:${base * multiplier * unit}`);
    }
    return result;
  }
  for (const [symbol, values] of Object.entries(JSON.parse(raw) as Record<string, string[]>)) {
    const token = tokens[symbol];
    if (!token) throw new Error(`V3_FIXED_AMOUNTS_JSON references unknown token ${symbol}`);
    for (const value of values) result.add(`${getAddress(token)}:${BigInt(value)}`);
  }
  return result;
};
const makeOperator = async (contextDb: typeof db, contextVault: Address, v3 = false) => new Operator({
  db: contextDb, publicClient, walletClient, chainId, vault: contextVault, router,
  route: mock ? mockRoute : uniswapRoute(),
  quote: mock ? mockQuoter(publicClient, router) : uniswapQuoter({
    client: publicClient, v3Router: router, v3Quoter: env("UNISWAP_QUOTER_ADDR") as Address,
    v4Adapter: process.env["V4_ADAPTER_ADDR"] as Address | undefined, v4Quoter: process.env["V4_QUOTER_ADDR"] as Address | undefined,
  }),
  ...(!mock && process.env["POOL_V2_DEX_ADAPTER_ADDR"] ? {
    poolQuote: uniswapQuoter({
      client: publicClient, v3Router: router, v3Quoter: env("UNISWAP_QUOTER_ADDR") as Address,
      v4Adapter: getAddress(process.env["POOL_V2_DEX_ADAPTER_ADDR"] as Address),
      v4Quoter: env("V4_QUOTER_ADDR") as Address,
    }),
  } : {}),
  slippageBps: Number(env("SLIPPAGE_BPS", "50")), keeperFeeBps, v3Mode: v3,
  startBlock: process.env[v3 ? "V3_START_BLOCK" : "START_BLOCK"] ? BigInt(process.env[v3 ? "V3_START_BLOCK" : "START_BLOCK"]!) : await publicClient.getBlockNumber(),
  ...(stealth ? { stealth } : {}),
  splitPayouts: process.env["FEATURE_SPLIT_PAYOUTS"]?.trim().toLowerCase() === "true",
  anonymitySet: process.env["FEATURE_ANONYMITY_SET"]?.trim().toLowerCase() === "true",
  ticketSync: process.env["FEATURE_TICKET_SYNC"]?.trim().toLowerCase() === "true",
});
const operator = await makeOperator(db, vault);
const v3Vault = process.env["V3_VAULT_ADDR"] ? getAddress(process.env["V3_VAULT_ADDR"] as Address) : undefined;
const v3Db = v3Vault ? await bunSqlDb(env("V3_DATABASE_URL")) : undefined;
if (v3Db) await migrate(v3Db);
const v3Operator = v3Vault && v3Db ? await makeOperator(v3Db, v3Vault, true) : undefined;
if (v3Operator) console.log(`V3 context ON: ${v3Vault}`);

const api = createApi({
  db, operator, vault, tokens, keeperFeeBps, chainId,
  minBalanceWei: BigInt(env("MIN_OPERATOR_BALANCE_WEI", "5000000000000000")),
  ...(poolV2Publisher && poolV2Address && poolV2ManagerAddress ? { poolV4: { publisher: poolV2Publisher, pool: poolV2Address, rootManager: poolV2ManagerAddress } } : {}),
  ...(poolV2LegacyPublisher && poolV2LegacyAddress && poolV2LegacyManagerAddress ? { poolV4Legacy: [{ publisher: poolV2LegacyPublisher, pool: poolV2LegacyAddress, rootManager: poolV2LegacyManagerAddress }] } : {}),
  contexts: v3Operator && v3Db && v3Vault ? {
    v2: {
      db, operator, vault, tokens, keeperFeeBps,
      minBalanceWei: BigInt(env("MIN_OPERATOR_BALANCE_WEI", "5000000000000000")),
      ...(poolV2Publisher && poolV2Address && poolV2ManagerAddress ? { poolV4: { publisher: poolV2Publisher, pool: poolV2Address, rootManager: poolV2ManagerAddress } } : {}),
      ...(poolV2LegacyPublisher && poolV2LegacyAddress && poolV2LegacyManagerAddress ? { poolV4Legacy: [{ publisher: poolV2LegacyPublisher, pool: poolV2LegacyAddress, rootManager: poolV2LegacyManagerAddress }] } : {}),
    },
    v3: {
      db: v3Db, operator: v3Operator, vault: v3Vault, tokens, keeperFeeBps, v3Mode: true,
      fixedAmounts: await makeFixedAmounts(),
      minBalanceWei: BigInt(env("MIN_OPERATOR_BALANCE_WEI", "5000000000000000")),
      ...(poolV2Publisher && poolV2Address && poolV2ManagerAddress ? { poolV4: { publisher: poolV2Publisher, pool: poolV2Address, rootManager: poolV2ManagerAddress } } : {}),
      ...(poolV2LegacyPublisher && poolV2LegacyAddress && poolV2LegacyManagerAddress ? { poolV4Legacy: [{ publisher: poolV2LegacyPublisher, pool: poolV2LegacyAddress, rootManager: poolV2LegacyManagerAddress }] } : {}),
    },
  } : undefined,
});
const mcp = createMcpApi(api);

const server = Bun.serve({
  port: Number(process.env["PORT"] ?? env("OPERATOR_PORT", "3100")),
  fetch: (request) => new URL(request.url).pathname === "/mcp" ? mcp(request) : api(request),
});
console.log(`@curtain/operator listening on :${server.port}`);

const tickMs = Number(env("TICK_MS", "5000"));
for (;;) {
  const started = Date.now();
  const now = Math.floor(started / 1000);
  try {
    await operator.syncChain();
    if (poolV2Publisher) await poolV2Publisher.sync();
    if (poolV2LegacyPublisher) await poolV2LegacyPublisher.sync();
    await operator.cleanupExpiredIntents();
    await operator.processDue(now);
    await operator.submitSettlements(now);
    await operator.syncChain();
    await operator.processStealth();
    operator.markTick();
    if (v3Operator) {
      await v3Operator.syncChain();
      await v3Operator.cleanupExpiredIntents();
      await v3Operator.processDue(now);
      await v3Operator.submitSettlements(now);
      await v3Operator.syncChain();
      await v3Operator.processStealth();
      v3Operator.markTick();
    }
  } catch (e) {
    console.error("operator tick failed:", e instanceof Error ? e.message.split("\n")[0] : e);
  }
  await Bun.sleep(Math.max(0, tickMs - (Date.now() - started)));
}
