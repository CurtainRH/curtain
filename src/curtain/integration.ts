import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  custom,
  decodeErrorResult,
  defineChain,
  erc20Abi,
  formatUnits,
  http,
  isAddress,
  parseAbi,
  zeroAddress,
  type Address,
  type EIP1193Provider,
} from "viem";
import {
  CurtainClient,
  parseMetaAddress,
  StealthError,
  type EscapeTicket,
  type PendingTicket,
  type StealthMetaAddress,
} from "@curtain/sdk";
const env = import.meta.env;
// Always same-origin: the server relays /api/curtain/* to the operator (src/lib/curtain-proxy.ts),
// so the operator URL never reaches the browser.
export const apiUrl = "/api/curtain";
export const chain = defineChain({
  id: Number(env["VITE_CHAIN_ID"] || 4663),
  name: Number(env["VITE_CHAIN_ID"] || 4663) === 4663 ? "Robinhood Chain" : "Curtain local chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [env["VITE_RPC_URL"] || "https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: {
      name: "Explorer",
      url: env["VITE_EXPLORER_URL"] || "https://robinhoodchain.blockscout.com",
    },
  },
});
export const publicClient = createPublicClient({ chain, transport: http() });
export function address(value: unknown): Address | undefined {
  return typeof value === "string" && isAddress(value) && value.toLowerCase() !== zeroAddress
    ? value
    : undefined;
}
export const staking = address(
  env["VITE_STAKING_ADDR"] || "0xA0328Ada6694e95D7e946dFD54611BA57ACCA8c8",
);
export const stakeToken = address(env["VITE_STAKE_TOKEN_ADDR"]);
/** ERC-5564 announcer the operator announces stealth payouts on (deployments/4663.json). */
export const stealthAnnouncer = address(
  env["VITE_STEALTH_ANNOUNCER_ADDR"] || "0x88F605D395EAB3ef5429CE20aCE36a5a142D31d3",
);
/** No announcement or payout can be older than the vault's first block. */
export const stealthScanFromBlock = /^\d+$/.test(env["VITE_STEALTH_FROM_BLOCK"] || "")
  ? BigInt(env["VITE_STEALTH_FROM_BLOCK"])
  : 80903085n;
/** ERC-6538 registry where receivers publish stealth meta-addresses (deployments/4663.json). */
export const stealthRegistry = address(
  env["VITE_STEALTH_REGISTRY_ADDR"] || "0x2143162F34BdE1fAc92544461d0850d3c4e89a9D",
);
export const fallbackVault = address(
  env["VITE_VAULT_ADDR"] || "0x72D3820D386b887c93A09766dbecA9BC80e224C0",
);
export const stakingBlock = /^\d+$/.test(env["VITE_STAKING_FROM_BLOCK"] || "")
  ? BigInt(env["VITE_STAKING_FROM_BLOCK"])
  : 80903085n;
export function provider() {
  return (window as Window & { ethereum?: EIP1193Provider }).ethereum;
}
export async function ensureChain() {
  const p = provider();
  if (!p) throw new Error("Connect a browser wallet first.");
  if ((await publicClient.getChainId()) !== chain.id)
    throw new Error("The RPC network does not match Curtain’s configured network.");
  const id = `0x${chain.id.toString(16)}`;
  if ((await p.request({ method: "eth_chainId" })) === id) return;
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: id }] });
  } catch (e) {
    if ((e as { code?: number }).code !== 4902) throw e;
    await p.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: id,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: chain.rpcUrls.default.http,
          blockExplorerUrls: [chain.blockExplorers.default.url],
        },
      ],
    });
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: id }] });
  }
}
export function client(wallet?: string) {
  const p = provider();
  return new CurtainClient({
    apiUrl,
    fetch: async (input, init) => {
      try {
        return await fetch(input, { ...init, signal: AbortSignal.timeout(8000) });
      } catch {
        throw new Error(OFFLINE_MESSAGE);
      }
    },
    publicClient,
    // Pinned from the app's own config: the SDK refuses to deposit into, or refund from, any
    // other vault, even if the API (or an imported ticket file) names one.
    ...(fallbackVault ? { vaultAddress: fallbackVault } : {}),
    ...(staking ? { stakingAddress: staking } : {}),
    ...(wallet && p && isAddress(wallet)
      ? { walletClient: createWalletClient({ chain, transport: custom(p), account: wallet }) }
      : {}),
  });
}
const decimalsCache = new Map<string, Promise<number>>();
export function decimals(token: Address) {
  const key = `${chain.id}:${token.toLowerCase()}`;
  let result = decimalsCache.get(key);
  if (!result) {
    result = publicClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" });
    decimalsCache.set(key, result);
    result.catch(() => decimalsCache.delete(key));
  }
  return result;
}
export const errorAbi = parseAbi([
  "error TokenNotAllowed(address token)",
  "error DepositsArePaused()",
  "error DeadlineHashReused()",
  "error TooEarly(uint256 availableAt)",
  "error WrongDeadline()",
  "error NotDepositor()",
  "error WrongStatus(uint8 status)",
  "error Locked(uint64 unlockAt)",
  "error TokensNotSet()",
]);
export function countdown(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
}
/** An error whose message is already written for the user and must be shown as is. */
export class UserMessageError extends Error {}

export function errorMessage(e: unknown): string {
  if (e instanceof UserMessageError) return e.message;
  if (e instanceof BaseError) {
    const rejection = e.walk(
      (x) =>
        !!x &&
        ((x as { code?: number }).code === 4001 ||
          (x as { name?: string }).name === "UserRejectedRequestError"),
    );
    if (
      rejection &&
      ((rejection as { code?: number }).code === 4001 ||
        (rejection as { name?: string }).name === "UserRejectedRequestError")
    )
      return "You cancelled in your wallet. Nothing was sent.";
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const mapped = contractMessage(revert.data?.errorName, revert.data?.args?.[0]);
      if (mapped) return mapped;
    }
    const withData = e.walk((x) => !!x && typeof (x as { data?: unknown }).data === "string");
    const data = (withData as { data?: unknown } | null)?.data;
    if (typeof data === "string") {
      try {
        const decoded = decodeErrorResult({ abi: errorAbi, data: data as `0x${string}` });
        const mapped = contractMessage(decoded.errorName, decoded.args?.[0]);
        if (mapped) return mapped;
      } catch {
        /* Other contract errors use the wallet's message. */
      }
    }
  }
  if ((e as { code?: number })?.code === 4001)
    return "You cancelled in your wallet. Nothing was sent.";
  if (e instanceof TypeError || isConnectivityError(e)) return OFFLINE_MESSAGE;
  const raw = e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message : "";
  return friendlyText(raw);
}

export const OFFLINE_MESSAGE =
  "Swaps are briefly unavailable while Curtain reconnects. Your funds are safe, and refunds still work from Activity.";
const GENERIC_MESSAGE = "Something went wrong. Please try again in a moment.";

/** Network, timeout, gateway and "operator offline" failures: the service, not the user, is at fault. */
export function isConnectivityError(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  const name = (e as { name?: string } | null)?.name ?? "";
  if (name === "AbortError" || name === "TimeoutError") return true;
  const text = e instanceof Error ? e.message : String(e ?? "");
  return /isn.t reachable|not reachable|offline|pending.deployment|OPERATOR_OFFLINE|fetch failed|failed to fetch|network ?error|timed? ?out|HTTP 5\d\d|\binternal error\b|Unexpected token|not valid JSON|\bECONN|\b50[234]\b/i.test(
    text,
  );
}

// Known technical messages (from the operator API, the SDK, viem and wallets) mapped to plain
// language. Anything unrecognised that looks technical falls back to a generic message.
const FRIENDLY: [RegExp, string][] = [
  [
    /user (rejected|denied)|rejected the request|cancell?ed/i,
    "You cancelled in your wallet. Nothing was sent.",
  ],
  [
    /insufficient funds|gas required exceeds|exceeds the balance of the account/i,
    "Your wallet doesn't have enough ETH to pay the network fee.",
  ],
  [
    /transfer amount exceeds balance|exceeds balance|insufficient balance/i,
    "You don't have enough of this token for that amount.",
  ],
  [/allowance/i, "Token approval didn't go through. Please approve and try again."],
  [/token not supported|TokenNotAllowed/i, "This token isn't supported."],
  [
    /no (route|liquidity|pool)|liquidity/i,
    "There isn't enough liquidity for this pair right now. Try a smaller amount.",
  ],
  [/amountIn|raw units|slippageBps|are required/i, "Enter a valid amount to swap."],
  [/unknown intent|not found/i, "This swap isn't showing yet. It can take a minute to appear."],
  [
    /rate.?limit|too many requests|429/i,
    "Curtain is busy right now. Please try again in a moment.",
  ],
  [
    /refusing to use vault|unexpected vault|inconsistent escape ticket|vault is not configured/i,
    "Swaps are paused as a safety precaution. Your funds are safe, and refunds still work from Activity.",
  ],
  [
    /does not match|chain mismatch|wrong network|unrecognized chain|switch.*chain/i,
    "Please switch your wallet to Robinhood Chain and try again.",
  ],
  [/nonce/i, "Your wallet has a pending transaction. Wait for it to finish, then try again."],
  [
    /reverted|execution reverted|no Deposited event|no Staked event/i,
    "The transaction didn't go through, so nothing changed. Please try again.",
  ],
  [/walletClient|connect a browser wallet|no wallet|provider/i, "Connect your wallet to continue."],
];

function friendlyText(raw: string): string {
  const text = raw.trim();
  if (!text) return GENERIC_MESSAGE;
  for (const [pattern, message] of FRIENDLY) if (pattern.test(text)) return message;
  const technical =
    text.length > 160 ||
    /\n|0x[\da-f]{8,}|Error:|Details:|Version:|Request Arguments|HTTP \d|undefined|null|\{|\}/i.test(
      text,
    );
  return technical ? GENERIC_MESSAGE : text;
}
export interface SavedTicket {
  intentId: string;
  ticket: EscapeTicket;
  createdAt: string;
  tokenIn: string;
  amountIn: string;
  tokenOut: string;
  recipient: string;
  depositTx?: string;
  delaySeconds?: number;
  chainId?: number;
  /** Paid to a one-time stealth address (ERC-5564); `recipient` is that address. */
  stealth?: boolean;
  /** Split payout: number of recipients; `recipient` is a summary. */
  split?: number;
  /** Delivered in pieces (split timing): this piece, e.g. "2/3". */
  piece?: string;
}
const storageKey = "curtain-tickets-v1";
export function validTicket(value: unknown): value is EscapeTicket {
  if (!value || typeof value !== "object") return false;
  const t = value as EscapeTicket;
  return (
    !!address(t.vault) &&
    typeof t.depositId === "string" &&
    /^\d+$/.test(t.depositId) &&
    BigInt(t.depositId) < 2n ** 256n &&
    typeof t.deadline === "string" &&
    /^\d+$/.test(t.deadline) &&
    Number.isSafeInteger(Number(t.deadline)) &&
    typeof t.salt === "string" &&
    /^0x[\da-f]{64}$/i.test(t.salt)
  );
}
export function readTickets(wallet: string): SavedTicket[] {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) || "{}");
    const rows: unknown = data[wallet.toLowerCase()];
    return Array.isArray(rows)
      ? rows.filter(
          (r): r is SavedTicket =>
            !!r &&
            validTicket(r.ticket) &&
            typeof r.intentId === "string" &&
            /^[\da-f]{32}$|^imported-\d+$/i.test(r.intentId) &&
            typeof r.createdAt === "string" &&
            typeof r.tokenIn === "string" &&
            typeof r.tokenOut === "string" &&
            typeof r.amountIn === "string" &&
            typeof r.recipient === "string",
        )
      : [];
  } catch {
    return [];
  }
}
/** True when a ticket belongs to the vault this app is configured for. */
export function trustedVault(vault: string) {
  return !!fallbackVault && vault.toLowerCase() === fallbackVault.toLowerCase();
}
/**
 * A swap whose ticket secrets were saved before the deposit was signed. Once the deposit is
 * found on-chain it becomes a full SavedTicket; until then it cannot be refunded (and if the
 * deposit never happened, nothing is at risk).
 */
export interface PendingSwap extends Omit<SavedTicket, "ticket" | "depositTx"> {
  pending: PendingTicket;
  fromBlock: string;
}
const pendingKey = "curtain-pending-v1";
export function readPending(wallet: string): PendingSwap[] {
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(pendingKey) || "{}")[
      wallet.toLowerCase()
    ];
    return Array.isArray(rows)
      ? rows.filter(
          (r): r is PendingSwap =>
            !!r &&
            typeof r.intentId === "string" &&
            /^\d+$/.test(r.fromBlock) &&
            !!r.pending &&
            !!address(r.pending.vault) &&
            /^\d+$/.test(r.pending.deadline) &&
            /^0x[\da-f]{64}$/i.test(r.pending.salt),
        )
      : [];
  } catch {
    return [];
  }
}
export function savePending(wallet: string, rows: PendingSwap[]) {
  try {
    const data = JSON.parse(localStorage.getItem(pendingKey) || "{}");
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    data[wallet.toLowerCase()] = rows;
    localStorage.setItem(pendingKey, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
export function saveTickets(wallet: string, rows: SavedTicket[]) {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) || "{}");
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    data[wallet.toLowerCase()] = rows;
    localStorage.setItem(storageKey, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

function contractMessage(name: string | undefined, arg?: unknown): string | undefined {
  if (name === "TooEarly")
    return `Not yet. Available in ${countdown(Number(arg) - Date.now() / 1000)}.`;
  if (name === "Locked")
    return `Still locked until ${new Date(Number(arg) * 1000).toLocaleString()}.`;
  const messages: Record<string, string> = {
    TokenNotAllowed: "This token isn't supported.",
    DepositsArePaused:
      "New swaps are paused for maintenance. Existing swaps and refunds still work.",
    DeadlineHashReused: "This swap was already deposited. Start a new swap.",
    WrongDeadline: "This ticket doesn't match the deposit.",
    NotDepositor: "Only the wallet that deposited can request this refund.",
    WrongStatus: "The swap may already have finished or been refunded. Refresh Activity.",
    TokensNotSet: "Staking isn't open yet.",
  };
  return name ? messages[name] : undefined;
}

const REGISTRY_ABI = parseAbi([
  "function stealthMetaAddressOf(address registrant, uint256 schemeId) view returns (bytes)",
]);

/**
 * Resolves what the sender typed into a receiver's stealth meta-address: either the meta-address
 * itself (st:eth:0x…) or a wallet address that published one in the stealth registry.
 * Throws a user-facing message when it can't.
 */
export async function resolveStealthRecipient(input: string): Promise<StealthMetaAddress> {
  const value = input.trim();
  if (isAddress(value)) {
    if (!stealthRegistry) throw new Error("Stealth address lookup isn't configured.");
    const raw = await publicClient.readContract({
      address: stealthRegistry,
      abi: REGISTRY_ABI,
      functionName: "stealthMetaAddressOf",
      args: [value, 1n],
    });
    if (!raw || raw === "0x")
      throw new Error(
        "This wallet hasn't published stealth keys. Ask the receiver for their stealth meta-address (st:eth:0x…).",
      );
    return parseMetaAddress(raw);
  }
  try {
    return parseMetaAddress(value);
  } catch (e) {
    throw new Error(
      e instanceof StealthError ? e.message : "Enter a stealth meta-address (st:eth:0x…).",
    );
  }
}

/**
 * Reads logs over a long block range in chunks, halving a chunk the RPC refuses (range or
 * result-size limits) instead of failing the whole scan.
 */
export async function logsInChunks<T>(
  from: bigint,
  to: bigint,
  read: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = [];
  let size = 2_000_000n;
  for (let start = from; start <= to;) {
    const end = start + size - 1n < to ? start + size - 1n : to;
    try {
      out.push(...(await read(start, end)));
      start = end + 1n;
    } catch (e) {
      if (size <= 5_000n) throw e;
      size /= 2n;
    }
  }
  return out;
}

/**
 * Splits `raw` into `n` random pieces for split timing: each at least half an equal piece, and
 * together exactly `raw`.
 */
export function pieceAmounts(raw: bigint, n: number): bigint[] {
  if (!Number.isInteger(n) || n < 2) throw new Error("Choose at least 2 pieces.");
  const weights = Array.from(crypto.getRandomValues(new Uint32Array(n)), (w) => BigInt(w) + 1n);
  const total = weights.reduce((a, b) => a + b, 0n);
  const floor = raw / BigInt(2 * n);
  const spare = raw - floor * BigInt(n);
  const out = weights.map((w) => floor + (spare * w) / total);
  out[n - 1] = out[n - 1]! + raw - out.reduce((a, b) => a + b, 0n);
  return out;
}

/**
 * Round-number nudge: deposit amounts are public, so an amount with many significant digits
 * (1,234.57) is easy to match to its payout, while round ones (1,200) blend in. Returns the
 * round amounts just below and above, or null when the amount is already round enough: at most
 * two significant digits, or three ending in 5 (1,250).
 */
export function roundSuggestions(
  raw: bigint,
  decimals: number,
  balance?: bigint,
): { lower: string; higher?: string } | null {
  if (raw <= 0n) return null;
  const digits = raw.toString();
  const significant = digits.replace(/0+$/, "");
  if (significant.length <= 2 || (significant.length === 3 && significant.endsWith("5")))
    return null;
  const unit = 10n ** BigInt(digits.length - 2);
  const lower = (raw / unit) * unit;
  const higher = lower + unit;
  return {
    lower: formatUnits(lower, decimals),
    ...(balance === undefined || higher <= balance
      ? { higher: formatUnits(higher, decimals) }
      : {}),
  };
}

/** What the swap form knows about where the output goes. */
export type RecipientKind = "own" | "used" | "fresh" | "stealth" | "unknown";

export interface PrivacyFactor {
  label: string;
  points: number;
  max: number;
  /** How to score higher on this factor, when there's room. */
  tip?: string;
}

/**
 * #7 privacy score: an estimate from what the swap form controls, 1 to 5 in half points.
 * Timing (2), recipient (1.5), amount (1) and a random split (0.5) add up to 5. It describes how
 * easily this swap's deposit and payout can be matched, not a guarantee.
 */
export function privacyScore(s: {
  delaySeconds: number;
  pieces: boolean;
  recipient: RecipientKind;
  roundAmount: boolean;
  /** Random split recipients or deliver-in-pieces: no single payout matches the deposit. */
  randomSplit: boolean;
}): { score: number; factors: PrivacyFactor[] } {
  const timing = Math.min(
    2,
    (s.delaySeconds <= 0 ? 0 : s.delaySeconds < 86_400 ? 1 : 1.5) + (s.pieces ? 0.5 : 0),
  );
  const recipient = { own: 0, used: 0.5, unknown: 0.5, fresh: 1, stealth: 1.5 }[s.recipient];
  const factors: PrivacyFactor[] = [
    {
      label:
        s.delaySeconds <= 0
          ? "Instant payout"
          : `Private delay${s.delaySeconds >= 86_400 ? " of a day or more" : ""}${s.pieces ? ", in pieces" : ""}`,
      points: timing,
      max: 2,
      ...(timing < 2
        ? {
            tip:
              s.delaySeconds <= 0
                ? "Add a private delay so the payout doesn't follow your deposit right away."
                : s.delaySeconds < 86_400
                  ? "A delay window of a day or more hides the timing better."
                  : "Deliver in pieces to spread the payout over several random times.",
          }
        : {}),
    },
    {
      label: {
        own: "Paying your own connected wallet",
        used: "Recipient has on-chain history",
        unknown: "Recipient",
        fresh: "Recipient with no on-chain activity found",
        stealth: "Stealth address",
      }[s.recipient],
      points: recipient,
      max: 1.5,
      ...(recipient < 1.5
        ? {
            tip:
              s.recipient === "own"
                ? "Sending to the wallet you deposit from links both ends. Use a fresh or stealth address."
                : "A stealth address gives the receiver a brand-new address nobody can link to them.",
          }
        : {}),
    },
    {
      label: s.roundAmount ? "Round amount" : "Distinctive amount",
      points: s.roundAmount ? 1 : 0,
      max: 1,
      ...(s.roundAmount ? {} : { tip: "Round amounts blend in with other deposits." }),
    },
    {
      label: s.randomSplit ? "Random-sized payouts" : "Single payout amount",
      points: s.randomSplit ? 0.5 : 0,
      max: 0.5,
      ...(s.randomSplit
        ? {}
        : { tip: "Splitting into random amounts means no payout matches your deposit." }),
    },
  ];
  const total = factors.reduce((sum, f) => sum + f.points, 0);
  return { score: Math.max(1, Math.round(total * 2) / 2), factors };
}
