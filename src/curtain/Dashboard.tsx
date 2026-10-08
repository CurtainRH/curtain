import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coins,
  Download,
  Inbox,
  Info,
  LayoutDashboard,
  Menu,
  RefreshCw,
  Repeat2,
  Search,
  Wallet,
  X,
} from "lucide-react";
import {
  createWalletClient,
  custom,
  erc20Abi,
  formatUnits,
  isAddress,
  parseUnits,
  type Address,
} from "viem";
import {
  CHALLENGE_WINDOW_SECONDS,
  generateStealthAddress,
  ROBINHOOD_CHAIN_TOKENS,
  TIERS,
  VAULT_ABI,
  type SplitMode,
  type WaitingDeposits,
  type StealthIntent,
  type StealthMetaAddress,
  type SwapQuote,
} from "@curtain/sdk";
import { Logo, RouteLink, Socials, useNav } from "./App";
import { downloadFile } from "./domain";
import { useFeatures } from "./features";
import FreshWallet from "./FreshWallet";
import PrivacyScore from "./PrivacyScore";
import StealthReceive from "./StealthReceive";
import { useWorkspaceTools } from "./useWorkspaceTools";
import {
  address,
  apiUrl,
  chain,
  countdown,
  ensureChain,
  errorMessage,
  OFFLINE_MESSAGE,
  pieceAmounts,
  publicClient,
  provider,
  recipientLinkWarnings,
  resolveStealthRecipient,
  aboutDuration,
  DELAY_PRESETS,
  presetWindow,
  type DelayPreset,
  roundSuggestions,
  type RecipientKind,
  stakeToken,
  staking,
  stakingBlock,
  trustedVault,
  UserMessageError,
  validTicket,
  type SavedTicket,
  curtainMode,
  type CurtainMode,
} from "./integration";
import { balanceText, useCurtain, type TokenData } from "./useCurtain";
const nav = [
  { id: "overview", path: "/app", name: "Overview", icon: LayoutDashboard },
  { id: "swap", path: "/app/swap", name: "Swap", icon: Repeat2 },
  { id: "stake", path: "/app/stake", name: "Stake", icon: Coins },
  { id: "activity", path: "/app/activity", name: "Activity", icon: Activity },
  { id: "receive", path: "/app/receive", name: "Receive", icon: Inbox },
];
function Note({ children }: { children: ReactNode }) {
  return (
    <div className="notice">
      <Info size={16} />
      <p>{children}</p>
    </div>
  );
}
function AlertModal({ message, close }: { message: string; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  return (
    <dialog ref={ref} className="modal dashboard-alert" onCancel={close}>
      <button className="modal-close" aria-label="Close warning" onClick={close}><X size={18} /></button>
      <p className="eyebrow">A NOTE FROM THE CURTAIN</p>
      <h2>Before you continue</h2>
      <p>{message}</p>
      <button className="button gold" onClick={close}>Understood</button>
    </dialog>
  );
}
function Token({ token }: { token: TokenData }) {
  return (
    <span className="token-icon">
      <img src={token.logo} alt={token.symbol} width={34} height={34} />
    </span>
  );
}
function rawAmount(value: string, d: number) {
  if (
    !new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${Math.max(1, d)}})?$`).test(value) ||
    (d === 0 && value.includes("."))
  )
    throw new Error(`Enter an amount with up to ${d} decimal places.`);
  const raw = parseUnits(value, d);
  if (raw <= 0n || raw >= 2n ** 256n)
    throw new Error("Enter an amount greater than zero and within the supported range.");
  return raw;
}
const statusCopy = {
  awaiting_deposit: "Waiting for your deposit",
  deposited: "Swapping…",
  settling: "Delivering…",
  paid: "Delivered",
  blocked: "This token can't be sent to that recipient.",
  expired: "Deposit didn't match this swap.",
  refund_requested: "Refund in progress",
  refunded: "Refunded to your wallet",
  challenged: "This swap was already delivered; the refund was declined.",
};

export const TOKEN_CATEGORIES = [
  { id: "all", label: "All Assets" },
  { id: "tech", label: "Tech & AI" },
  { id: "etf", label: "ETFs & Commodities" },
  { id: "crypto", label: "Crypto & FinTech" },
  { id: "retail", label: "Meme & Retail" },
  { id: "bluechip", label: "High-Cap Bluechips" },
] as const;

export const CATEGORY_MAP: Record<string, { label: string; badgeClass: string }> = {
  all: { label: "All Assets", badgeClass: "badge-all" },
  tech: { label: "Tech & AI", badgeClass: "badge-tech" },
  etf: { label: "ETFs & Commodities", badgeClass: "badge-etf" },
  crypto: { label: "Crypto & FinTech", badgeClass: "badge-crypto" },
  retail: { label: "Meme & Retail", badgeClass: "badge-retail" },
  bluechip: { label: "High-Cap Bluechips", badgeClass: "badge-bluechip" },
};

export default function Dashboard({ path }: { path: string }) {
  const { wallet, connect, navigate } = useNav();
  const app = useCurtain(wallet);
  const mode = curtainMode();
  const features = useFeatures();
  // "Receive" exists only while one of its features (FEATURE_STEALTH_KEYS / _INBOX) is on.
  const navItems = nav.filter(
    (n) => n.id !== "receive" || features.stealthKeys || features.stealthInbox,
  );
  const current = navItems.find((n) => n.id === (path.split("/")[2] || "overview")) || navItems[0]!;

  function switchCurtain(nextMode: CurtainMode) {
    if (nextMode === mode || busy) return;
    localStorage.setItem("curtain-mode", nextMode);
    window.location.reload();
  }

  useWorkspaceTools(current.id, navigate);
  const [sideOpen, setSideOpen] = useState(false);
  const [retracted, setRetracted] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        return localStorage.getItem("curtain_sidebar_retracted") === "true";
      } catch {
        return false;
      }
    }
    return false;
  });

  const toggleRetract = () => {
    setRetracted((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("curtain_sidebar_retracted", String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [alertMessage, setAlertMessage] = useState("");
  const [from, setFrom] = useState("USDG");
  const [to, setTo] = useState("NVDA");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState(wallet);
  // #9: a wallet created here can't be used until the user confirms they saved its file.
  const [freshWallet, setFreshWallet] = useState<{ address: Address; saved: boolean }>();
  const freshUnsaved =
    !!freshWallet &&
    !freshWallet.saved &&
    recipient.trim().toLowerCase() === freshWallet.address.toLowerCase();
  // Stealth payouts: shown only when the server flag (FEATURE_STEALTH_PAYOUTS) and the operator
  // both have them on.
  const stealthAvailable = features.stealthPayouts && !!app.stealth;
  const [stealthMode, setStealthMode] = useState(false);
  const useStealth = stealthAvailable && stealthMode;
  const [stealthInput, setStealthInput] = useState("");
  const [stealthMeta, setStealthMeta] = useState<StealthMetaAddress>();
  const [stealthNote, setStealthNote] = useState("");
  // Split payouts: FEATURE_SPLIT_PAYOUTS on the server and on the operator.
  const splitAvailable = features.splitPayouts && !!app.split;
  const [splitOn, setSplitOn] = useState(false);
  const useSplit = splitAvailable && splitOn;
  const maxSplit = Math.min(5, app.split?.maxRecipients ?? 5);
  const [splitTo, setSplitTo] = useState<string[]>(["", ""]);
  const [splitMode, setSplitMode] = useState<SplitMode>("random");
  /** Why the split recipients can't be used yet, or "" when they can. */
  const splitProblem = (() => {
    if (!useSplit) return "";
    const entries = splitTo.map((r) => r.trim());
    if (entries.some((r) => !r)) return "Fill in every recipient, or remove the empty ones.";
    if (useStealth) return ""; // resolved when you swap
    for (const r of entries)
      if (!isAddress(r) || !address(r) || r.toLowerCase() === app.vault?.toLowerCase())
        return "Every recipient must be a valid address other than the zero address or vault.";
    if (new Set(entries.map((r) => r.toLowerCase())).size !== entries.length)
      return "Each recipient must be a different address.";
    return "";
  })();
  const [delayed, setDelayed] = useState(false);
  const [delay, setDelay] = useState("3600");
  const [customDelay, setCustomDelay] = useState("3600");
  const [slippage, setSlippage] = useState(100);
  const [quote, setQuote] = useState<SwapQuote>();
  const [quoteError, setQuoteError] = useState("");
  const [quoting, setQuoting] = useState(false);
  useEffect(() => {
    if (app.error) setAlertMessage(app.error);
  }, [app.error]);
  useEffect(() => {
    if (app.storageWarning) setAlertMessage(app.storageWarning);
  }, [app.storageWarning]);
  useEffect(() => {
    if (quoteError && !app.offline) setAlertMessage(quoteError);
  }, [quoteError, app.offline]);
  const [latest, setLatest] = useState<SavedTicket>();
  const [stakeAmount, setStakeAmount] = useState("");
  const [tier, setTier] = useState<0 | 1 | 2>(0);
  const importRef = useRef<HTMLInputElement>(null);
  const requestNumber = useRef(0);
  const input = app.tokens.find((t) => t.symbol === from);
  const output = app.tokens.find((t) => t.symbol === to);
  // #11: Quick / Better / Best presets. The random window is drawn when a preset is picked, so
  // the score and the swap use the same value; picking again draws a new one.
  const [delayPreset, setDelayPreset] = useState<DelayPreset | "custom">("better");
  const [presetSeconds, setPresetSeconds] = useState(() => presetWindow("better", 15552000));
  const usePresets = features.delayPresets && delayPreset !== "custom";
  const delaySeconds = !delayed
    ? 0
    : usePresets
      ? Math.min(presetSeconds, app.maxDelay)
      : Number(delay === "custom" ? customDelay : delay);
  // Split timing (#5): the swap becomes 2-5 separate private swaps, each with its own escape
  // ticket and its own random delivery time inside the delay window. Separate deposits keep
  // every piece fully refundable on its own (one deposit paid in parts could not be).
  const piecesAvailable = features.splitTiming && delayed && !useSplit;
  const [piecesOn, setPiecesOn] = useState(false);
  const usePieces = piecesAvailable && piecesOn;
  const [pieceCount, setPieceCount] = useState(3);

  const [pickingTarget, setPickingTarget] = useState<"from" | "to" | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: app.tokens.length };
    for (const t of app.tokens) {
      const cat = t.category || "bluechip";
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [app.tokens]);

  const filteredTokens = useMemo(() => {
    return app.tokens.filter((t) => {
      const matchesCategory =
        selectedCategory === "all" || (t.category || "bluechip") === selectedCategory;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        (t.category && (CATEGORY_MAP[t.category]?.label || "").toLowerCase().includes(q));
      return matchesCategory && matchesSearch;
    });
  }, [app.tokens, selectedCategory, searchQuery]);
  useEffect(() => {
    setRecipient(wallet);
    setLatest(undefined);
    setMessage("");
  }, [wallet]);
  useEffect(() => {
    setSideOpen(false);
    setMessage("");
  }, [path]);
  // #10: warnings when a plain recipient links back to the user (debounced; never blocks).
  const [linkWarnings, setLinkWarnings] = useState<string[]>([]);
  const linkKey = (useSplit ? splitTo : [recipient]).join(",");
  useEffect(() => {
    setLinkWarnings([]);
    if (!features.sameWalletWarning || useStealth || !address(wallet)) return;
    let alive = true;
    const timer = setTimeout(() => {
      recipientLinkWarnings(wallet, linkKey.split(","))
        .then((w) => alive && setLinkWarnings(w))
        .catch(() => alive && setLinkWarnings([]));
    }, 600);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [features.sameWalletWarning, useStealth, linkKey, wallet]);
  // #8: deposits waiting to be paid, per input token, from the operator (refreshed every 30 s
  // while the swap page is open).
  const [waiting, setWaiting] = useState<WaitingDeposits>();
  const showPool = features.anonymitySet && app.poolEnabled && current.id === "swap";
  useEffect(() => {
    if (!showPool) {
      setWaiting(undefined);
      return;
    }
    let alive = true;
    const load = () =>
      app.sdk
        .waitingDeposits()
        .then((w) => alive && setWaiting(w))
        .catch(() => alive && setWaiting(undefined));
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [showPool, app.sdk]);
  // #7: what the privacy score knows about the recipient(s): stealth, the connected wallet
  // itself, a fresh address (no transactions, no ETH, no code, none of the output token) or
  // one with history.
  const [recipientKind, setRecipientKind] = useState<RecipientKind>("unknown");
  const recipientsKey = (useSplit ? splitTo : [recipient]).join(",");
  const outputToken = output?.address;
  useEffect(() => {
    if (!features.privacyScore) return;
    if (useStealth) {
      setRecipientKind("stealth");
      return;
    }
    const list = recipientsKey.split(",").map((r) => r.trim());
    if (!list.every((r) => isAddress(r))) {
      setRecipientKind("unknown");
      return;
    }
    if (address(wallet) && list.some((r) => r.toLowerCase() === wallet.toLowerCase())) {
      setRecipientKind("own");
      return;
    }
    let alive = true;
    setRecipientKind("unknown");
    const timer = setTimeout(() => {
      Promise.all(
        list.map(async (r) => {
          const [nonce, balance, code, held] = await Promise.all([
            publicClient.getTransactionCount({ address: r as Address }),
            publicClient.getBalance({ address: r as Address }),
            publicClient.getCode({ address: r as Address }),
            outputToken
              ? publicClient.readContract({
                  address: outputToken,
                  abi: erc20Abi,
                  functionName: "balanceOf",
                  args: [r as Address],
                })
              : Promise.resolve(0n),
          ]);
          return nonce === 0 && balance === 0n && (!code || code === "0x") && held === 0n;
        }),
      )
        .then((fresh) => alive && setRecipientKind(fresh.every(Boolean) ? "fresh" : "used"))
        .catch(() => alive && setRecipientKind("unknown"));
    }, 500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [features.privacyScore, useStealth, recipientsKey, wallet, outputToken]);
  useEffect(() => {
    setStealthMeta(undefined);
    setStealthNote("");
    if (!useStealth || !stealthInput.trim()) return;
    let alive = true;
    const timer = setTimeout(() => {
      resolveStealthRecipient(stealthInput)
        .then((meta) => alive && setStealthMeta(meta))
        .catch((e: unknown) => alive && setStealthNote(errorMessage(e)));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [useStealth, stealthInput]);
  useEffect(() => {
    let alive = true;
    setQuote(undefined);
    setQuoteError("");
    const load = async () => {
      const number = ++requestNumber.current;
      if (!input || !output || !amount || !apiUrl || current.id !== "swap") {
        setQuoting(false);
        return;
      }
      setQuoting(true);
      try {
        const q = await app.sdk.quote(
          input.address,
          output.address,
          rawAmount(amount, input.decimals),
          slippage,
          {
            stealth: useStealth,
            ...(useSplit ? { splits: splitTo.length, splitMode } : {}),
          },
        );
        if (alive && number === requestNumber.current) {
          setQuote(q);
          setQuoteError("");
        }
      } catch (e) {
        if (alive && number === requestNumber.current) {
          setQuote(undefined);
          setQuoteError(errorMessage(e));
        }
      } finally {
        if (alive && number === requestNumber.current) setQuoting(false);
      }
    };
    const first = setTimeout(() => void load(), 400);
    const timer = setInterval(() => void load(), 15000);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [
    input,
    output,
    amount,
    slippage,
    current.id,
    app.sdk,
    useStealth,
    useSplit,
    splitTo.length,
    splitMode,
  ]);
  function link(hash: string, label: string) {
    return (
      <a
        href={`${chain.blockExplorers.default.url}/tx/${hash}`}
        target="_blank"
        rel="noreferrer"
        className="underlined-link"
      >
        {label}
        <ArrowUpRight size={13} />
      </a>
    );
  }
  async function run(label: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setMessage("");
    app.setError("");
    try {
      await ensureChain();
      const accounts = await provider()?.request({ method: "eth_accounts" });
      if (accounts?.[0]?.toLowerCase() !== wallet.toLowerCase())
        throw new Error("Your wallet account changed. Reconnect before continuing.");
      await action();
    } catch (e) {
      setAlertMessage(errorMessage(e));
      await app.refreshActivity(true);
    } finally {
      setBusy("");
    }
  }
  function download(row: SavedTicket) {
    downloadFile(`curtain-escape-ticket-${row.ticket.depositId}.json`, {
      ...row,
      chainId: row.chainId || chain.id,
    });
  }
  async function swap() {
    if (!input || !output || !app.vault || !quote?.available || quoting) return;
    if (useSplit) {
      if (splitProblem) {
        setAlertMessage(splitProblem);
        return;
      }
    } else if (freshUnsaved && !useStealth) {
      setAlertMessage("Confirm you've saved the fresh wallet's file and password first.");
      return;
    } else if (useStealth) {
      if (!stealthMeta) {
        setAlertMessage(stealthNote || "Enter the receiver's stealth meta-address.");
        return;
      }
    } else if (
      !isAddress(recipient) ||
      !address(recipient) ||
      recipient.toLowerCase() === app.vault.toLowerCase()
    ) {
      setAlertMessage("Enter a recipient address other than the zero address or vault.");
      return;
    }
    if (
      !Number.isInteger(delaySeconds) ||
      (delayed ? delaySeconds < 1 : delaySeconds < 0) ||
      delaySeconds > app.maxDelay
    ) {
      setAlertMessage(`Choose a delay between 0 and ${app.maxDelay} seconds.`);
      return;
    }
    await run("Swap", async () => {
      const raw = rawAmount(amount, input.decimals);
      if (input.balance === undefined || raw > input.balance)
        throw new Error("Your token balance is too low for this swap.");
      const quoteOpts = {
        stealth: useStealth,
        ...(useSplit ? { splits: splitTo.length, splitMode } : {}),
      };
      const tooSmall = (q: SwapQuote, what: string) =>
        new Error(
          BigInt(q.marketOut) > 0n
            ? `This amount is too small ${what}. Try a larger amount.`
            : "No liquidity for this pair right now",
        );
      const what = usePieces
        ? `to deliver in ${pieceCount} pieces`
        : useSplit
          ? "to split"
          : useStealth
            ? "to deliver to a stealth address"
            : "";

      if (!usePieces) {
        // Refresh immediately before signing so minimum output matches the current form.
        const fresh = await app.sdk.quote(input.address, output.address, raw, slippage, quoteOpts);
        setQuote(fresh);
        if (!fresh.available) throw tooSmall(fresh, what);
        const row = await depositOne(raw, fresh);
        setLatest(row);
        download(row);
        setAmount("");
        setMessage(
          row.split
            ? `Deposit confirmed. It will be split between ${row.split} recipients in one payout. Escape ticket downloaded.`
            : row.stealth
              ? "Deposit confirmed. It will be delivered to a brand-new stealth address only the receiver can find. Escape ticket downloaded."
              : "Deposit confirmed. Your escape ticket has been downloaded.",
        );
        void app.refresh();
        return;
      }

      // Pieces: random sizes (each at least half an equal piece), quoted up front so nothing is
      // deposited unless every piece can be delivered.
      const amounts = pieceAmounts(raw, pieceCount);
      const quotes: SwapQuote[] = [];
      for (const piece of amounts) {
        const q = await app.sdk.quote(input.address, output.address, piece, slippage, quoteOpts);
        if (!q.available) throw tooSmall(q, what);
        quotes.push(q);
      }
      // One approval for the whole amount, so each piece only needs its deposit confirmed.
      const allowance = await publicClient.readContract({
        address: input.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [wallet as Address, app.vault!],
      });
      if (allowance < raw) {
        const p = provider();
        if (!p) throw new Error("Connect a browser wallet first.");
        const hash = await createWalletClient({ chain, transport: custom(p) }).writeContract({
          chain,
          account: wallet as Address,
          address: input.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [app.vault!, raw],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success")
          throw new Error("The approval didn't go through, so nothing was deposited.");
      }
      let done = 0;
      let last: SavedTicket | undefined;
      try {
        for (const [k, piece] of amounts.entries()) {
          last = await depositOne(piece, quotes[k]!, `${k + 1}/${pieceCount}`);
          done++;
        }
      } catch (e) {
        if (last) setLatest(last);
        if (done === 0) throw e;
        throw new UserMessageError(
          `${done} of ${pieceCount} pieces were deposited. Each one is a complete private swap with its own escape ticket in Activity. The rest stopped: ${errorMessage(e)}`,
        );
      } finally {
        void app.refresh();
      }
      if (last) {
        setLatest(last);
        download(last);
      }
      setAmount("");
      setMessage(
        `All ${pieceCount} pieces deposited. Each arrives at its own random time inside the delay window. Escape tickets downloaded & available in Activity.`,
      );
    });
  }

  /** Creates one intent and deposits it; returns its saved escape ticket. */
  async function depositOne(raw: bigint, fresh: SwapQuote, piece?: string): Promise<SavedTicket> {
    // Stealth: a brand-new one-time address per recipient and per piece, derived here in the
    // browser. Only the receiver (with their keys) can find it and spend from it.
    let splits: { recipient: Address; stealth?: StealthIntent }[] | undefined;
    if (useSplit) {
      const entries = splitTo.map((r) => r.trim());
      if (useStealth) {
        const metas = await Promise.all(entries.map((r) => resolveStealthRecipient(r)));
        splits = metas.map((m) => {
          const p = generateStealthAddress(m);
          return {
            recipient: p.stealthAddress,
            stealth: { ephemeralPublicKey: p.ephemeralPublicKey, viewTag: p.viewTag },
          };
        });
      } else {
        splits = entries.map((r) => ({ recipient: r as Address }));
      }
    }
    const pay =
      !useSplit && useStealth && stealthMeta ? generateStealthAddress(stealthMeta) : undefined;
    const payTo = splits ? splits[0]!.recipient : pay ? pay.stealthAddress : (recipient as Address);
    const fromBlock = await publicClient.getBlockNumber();
    const details = {
      createdAt: new Date().toISOString(),
      tokenIn: from,
      amountIn: formatUnits(raw, input!.decimals),
      tokenOut: to,
      recipient: splits ? `${splits.length} recipients` : payTo,
      delaySeconds,
      chainId: chain.id,
      ...(pay || (splits && useStealth) ? { stealth: true } : {}),
      ...(splits ? { split: splits.length } : {}),
      ...(piece ? { piece } : {}),
    };
    let pendingId = "";
    const result = await app.sdk
      .swap(
        {
          tokenIn: input!.address,
          amountIn: raw,
          tokenOut: output!.address,
          recipient: payTo,
          minOut: BigInt(fresh.minOutSuggested),
          delaySeconds,
          ...(pay
            ? { stealth: { ephemeralPublicKey: pay.ephemeralPublicKey, viewTag: pay.viewTag } }
            : {}),
          ...(splits ? { splits, splitMode } : {}),
        },
        {
          // Keep the ticket secrets before the wallet signs, so closing the tab mid-deposit
          // can't strand funds without a refund path.
          onIntent: (pending) => {
            pendingId = pending.intentId;
            app.addPending({
              ...details,
              intentId: pending.intentId,
              pending,
              fromBlock: fromBlock.toString(),
            });
          },
        },
      )
      .catch((e: unknown) => {
        // A wallet cancellation means no deposit was sent, so there is nothing to recover.
        if (pendingId && errorMessage(e).startsWith("You cancelled")) app.removePending(pendingId);
        throw e;
      });
    const row: SavedTicket = {
      ...details,
      intentId: result.intentId,
      ticket: result.ticket,
      depositTx: result.depositTx,
    };
    app.addTicket(row);
    app.removePending(result.intentId);
    return row;
  }
  async function importTicket(file: File) {
    try {
      if (!address(wallet))
        throw new Error("Connect the depositing wallet before importing a ticket.");
      if (file.size > 100000) throw new Error("This ticket file is too large.");
      const data: unknown = JSON.parse(await file.text());
      const source = data as Partial<SavedTicket>;
      const ticket = validTicket(data) ? data : source.ticket;
      if (!validTicket(ticket)) throw new Error("This file is not a valid Curtain escape ticket.");
      if (!trustedVault(ticket.vault))
        throw new Error(
          "This ticket is for a different vault than Curtain's. It was not imported.",
        );
      if (source.chainId !== undefined && source.chainId !== chain.id)
        throw new Error("This ticket belongs to a different network.");
      const [owner, token, raw] = await publicClient.readContract({
        address: ticket.vault,
        abi: VAULT_ABI,
        functionName: "deposits",
        args: [BigInt(ticket.depositId)],
      });
      if (owner.toLowerCase() !== wallet.toLowerCase())
        throw new Error("Only the wallet that deposited can import this refund ticket.");
      const { decimals } = await import("./integration");
      const d = await decimals(token);
      const symbol =
        app.tokens.find((t) => t.address.toLowerCase() === token.toLowerCase())?.symbol ||
        `${token.slice(0, 6)}…${token.slice(-4)}`;
      app.addTicket({
        intentId:
          typeof source.intentId === "string" && /^[\da-f]{32}$/i.test(source.intentId)
            ? source.intentId
            : `imported-${ticket.depositId}`,
        ticket,
        createdAt:
          typeof source.createdAt === "string" && !Number.isNaN(Date.parse(source.createdAt))
            ? source.createdAt
            : new Date().toISOString(),
        tokenIn: symbol,
        amountIn: formatUnits(raw, d),
        tokenOut: typeof source.tokenOut === "string" ? source.tokenOut : "Recipient token",
        recipient: typeof source.recipient === "string" ? source.recipient : "—",
        chainId: chain.id,
        ...(typeof source.depositTx === "string" && /^0x[\da-f]{64}$/i.test(source.depositTx)
          ? { depositTx: source.depositTx }
          : {}),
        ...(typeof source.delaySeconds === "number" ? { delaySeconds: source.delaySeconds } : {}),
      });
      setMessage("Ticket imported. Refunds use the vault directly.");
    } catch (e) {
      setMessage(errorMessage(e));
    }
  }
  async function refund(row: SavedTicket, finish: boolean) {
    await run(finish ? "Finish refund" : "Refund", async () => {
      const hash = finish
        ? await app.sdk.finalizeRefund(row.ticket)
        : await app.sdk.requestRefund(row.ticket);
      setMessage(`Refund transaction confirmed: ${hash}`);
      await app.refreshActivity(true);
    });
  }
  function rows(onlyOpen = false) {
    const list = app.tickets.filter(
      (r) =>
        !onlyOpen ||
        (!["paid", "refunded", "challenged"].includes(app.statuses[r.intentId]?.status || "") &&
          ![3, 4].includes(app.deposits[r.intentId]?.status || 0)),
    );
    return list.length || app.pending.length ? (
      <div className="v2-activity">
        {app.pending.map((p) => (
          <article className="v2-activity-row" key={`pending-${p.intentId}`}>
            <div>
              <small>{new Date(p.createdAt).toLocaleString()}</small>
              <strong className="v2-swap-pair">
                {p.amountIn} {p.tokenIn} → {p.tokenOut}
              </strong>
              <span className="pill">Waiting for deposit</span>
              <p>Your escape ticket appears here as soon as the deposit confirms.</p>
            </div>
          </article>
        ))}
        {list.map((row) => {
          const status = app.statuses[row.intentId];
          const deposit = app.deposits[row.intentId];
          const foreignVault = !trustedVault(row.ticket.vault);
          const wrongChain =
            (row.chainId !== undefined && row.chainId !== chain.id) || foreignVault;
          const requested = deposit?.status === 2;
          const terminal =
            deposit?.status === 3 ||
            deposit?.status === 4 ||
            ["paid", "refunded", "challenged"].includes(status?.status || "");
          const text =
            deposit?.status === 4
              ? statusCopy.refunded
              : deposit?.status === 3
                ? statusCopy.challenged
                : requested
                  ? statusCopy.refund_requested
                  : status
                    ? status.status === "deposited" && row.delaySeconds
                      ? "Scheduled (private delay)"
                      : statusCopy[status.status]
                    : "Service unavailable — ticket ready";
          const remaining = (deposit?.requestedAt || 0) + CHALLENGE_WINDOW_SECONDS + 1 - app.now;
          return (
            <article
              className="v2-activity-row"
              key={`${row.ticket.vault}-${row.ticket.depositId}`}
            >
              <div>
                <small>{new Date(row.createdAt).toLocaleString()}</small>
                <strong className="v2-swap-pair">
                  {ROBINHOOD_CHAIN_TOKENS.find((t) => t.symbol === row.tokenIn)?.logo && (
                    <img
                      src={ROBINHOOD_CHAIN_TOKENS.find((t) => t.symbol === row.tokenIn)!.logo}
                      alt=""
                      width={24}
                      height={24}
                    />
                  )}{" "}
                  {row.amountIn} {row.tokenIn} →{" "}
                  {ROBINHOOD_CHAIN_TOKENS.find((t) => t.symbol === row.tokenOut)?.logo && (
                    <img
                      src={ROBINHOOD_CHAIN_TOKENS.find((t) => t.symbol === row.tokenOut)!.logo}
                      alt=""
                      width={24}
                      height={24}
                    />
                  )}{" "}
                  {row.tokenOut}
                </strong>
                <span>
                  Recipient{" "}
                  {row.recipient.length > 16
                    ? `${row.recipient.slice(0, 6)}…${row.recipient.slice(-4)}`
                    : row.recipient}
                  {row.piece ? ` · piece ${row.piece}` : ""}
                </span>
                <span className="pill">{text}</span>
                {status?.blockedReason && <p>{status.blockedReason}</p>}
                {wrongChain && (
                  <p>
                    {foreignVault
                      ? "This ticket is for a different vault than this app uses."
                      : `Switch configuration to network ${row.chainId} to use this ticket.`}
                  </p>
                )}
              </div>
              <div className="v2-actions">
                <button onClick={() => download(row)} className="text-button">
                  <Download size={14} />
                  Ticket
                </button>
                {row.depositTx && link(row.depositTx, "Deposit")}
                {status?.payoutTx && link(status.payoutTx, "Payout")}
                {!terminal &&
                  !wrongChain &&
                  (requested ? (
                    <>
                      <small>
                        {remaining > 0
                          ? `Finish refund in ${countdown(remaining)}`
                          : "Challenge window complete"}
                      </small>
                      <button
                        className="button gold"
                        disabled={!!busy || remaining > 0}
                        onClick={() => void refund(row, true)}
                      >
                        Finish refund
                      </button>
                    </>
                  ) : (
                    <>
                      <small>
                        {app.now < app.sdk.refundAvailableAt(row.ticket)
                          ? `Refund available in ${countdown(app.sdk.refundAvailableAt(row.ticket) - app.now)}`
                          : "Refund available"}
                      </small>
                      {app.now >= app.sdk.refundAvailableAt(row.ticket) && (
                        <button
                          className="button gold"
                          disabled={!!busy}
                          onClick={() => void refund(row, false)}
                        >
                          Get my deposit back
                        </button>
                      )}
                    </>
                  ))}
              </div>
            </article>
          );
        })}
      </div>
    ) : (
      <div className="empty-compact">
        <h3>Your next act awaits.</h3>
        <p>No {onlyOpen ? "open swaps" : "saved tickets"} for this wallet.</p>
      </div>
    );
  }
  function picker(id: string, value: string, target: "from" | "to") {
    const token = app.tokens.find((t) => t.symbol === value);
    const cat = token?.category ? CATEGORY_MAP[token.category] : undefined;
    return (
      <button
        id={id}
        type="button"
        className="asset-select-trigger"
        onClick={() => {
          setSearchQuery("");
          setSelectedCategory("all");
          setPickingTarget(target);
        }}
        aria-haspopup="dialog"
      >
        <div className="asset-trigger-left">
          {token && <Token token={token} />}
          <div className="asset-trigger-info">
            <div className="asset-trigger-title">
              <span className="asset-trigger-symbol">{token?.symbol || value}</span>
              {cat && <span className={`category-tag ${cat.badgeClass}`}>{cat.label}</span>}
            </div>
            <span className="asset-trigger-name">{token?.name || "Select token"}</span>
          </div>
        </div>
        <div className="asset-trigger-right">
          <span className="asset-trigger-balance">{token ? balanceText(token) : "—"}</span>
          <ChevronDown size={16} className="asset-trigger-chevron" />
        </div>
      </button>
    );
  }

  function tokenModal() {
    if (!pickingTarget) return null;
    const currentVal = pickingTarget === "from" ? from : to;
    return (
      <div
        className="token-modal-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget) setPickingTarget(null);
        }}
      >
        <div className="token-modal-card" role="dialog" aria-modal="true" aria-label="Select Token">
          <div className="token-modal-header">
            <div className="token-modal-title">
              <h3>Select {pickingTarget === "from" ? "deposit" : "recipient"} asset</h3>
              <p className="token-modal-subtitle">
                {app.tokens.length} verified assets on Robinhood Chain
              </p>
            </div>
            <button
              className="token-modal-close"
              type="button"
              onClick={() => setPickingTarget(null)}
              aria-label="Close modal"
            >
              <X size={18} />
            </button>
          </div>

          <div className="token-modal-search">
            <Search size={16} className="token-modal-search-icon" />
            <input
              type="text"
              autoFocus
              placeholder="Search by ticker, company, or category…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setPickingTarget(null);
              }}
            />
            {searchQuery && (
              <button
                className="token-modal-search-clear"
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="token-category-pills">
            {TOKEN_CATEGORIES.map((cat) => {
              const count = categoryCounts[cat.id] ?? 0;
              const isActive = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={`token-category-pill ${isActive ? "active" : ""}`}
                  onClick={() => setSelectedCategory(cat.id)}
                  aria-pressed={isActive}
                >
                  <span>{cat.label}</span>
                  <span className="token-category-count">{count}</span>
                </button>
              );
            })}
          </div>

          <div className="token-list-scroll">
            {filteredTokens.length > 0 ? (
              filteredTokens.map((t) => {
                const isSelected = t.symbol === currentVal;
                const catInfo = CATEGORY_MAP[t.category || "bluechip"];
                return (
                  <button
                    key={t.symbol}
                    type="button"
                    className={`token-list-row ${isSelected ? "selected" : ""}`}
                    onClick={() => {
                      if (pickingTarget === "from") setFrom(t.symbol);
                      else setTo(t.symbol);
                      setPickingTarget(null);
                    }}
                  >
                    <div className="token-list-left">
                      <Token token={t} />
                      <div className="token-list-names">
                        <div className="token-list-top">
                          <span className="token-list-symbol">{t.symbol}</span>
                          {catInfo && (
                            <span className={`category-tag ${catInfo.badgeClass}`}>
                              {catInfo.label}
                            </span>
                          )}
                        </div>
                        <span className="token-list-name">{t.name}</span>
                      </div>
                    </div>
                    <div className="token-list-right">
                      <span className="token-list-balance">{balanceText(t)}</span>
                      {isSelected && <Check size={16} className="token-list-check" />}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="token-modal-empty">
                <p>No assets found matching "{searchQuery}"</p>
                <small>Try searching another ticker or choosing another category.</small>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
  function positionTable() {
    return (
      <section className="panel">
        <div className="panel-heading">
          <h2>Your positions</h2>
          <span title="After unlocking, a position earns at 1×. Withdraw and restake to earn a multiplier again.">
            <Info size={16} />
          </span>
        </div>
        {app.positions.length ? (
          <div className="v2-table-scroll">
            <table className="v2-position-table">
              <thead>
                <tr>
                  <th>Amount</th>
                  <th>Tier</th>
                  <th>Unlock</th>
                  <th>Rewards</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {app.positions.map((p) => (
                  <tr key={p.id.toString()}>
                    <td>
                      {app.stakeDecimals === undefined
                        ? "—"
                        : formatUnits(p.amount, app.stakeDecimals)}{" "}
                      CRTN
                    </td>
                    <td>
                      {TIERS.find((t) => t.tier === app.positionTiers[p.id.toString()])
                        ? `${TIERS[app.positionTiers[p.id.toString()]!]!.days}d · ${TIERS[app.positionTiers[p.id.toString()]!]!.multiplier}×`
                        : "Loading tier…"}
                    </td>
                    <td>
                      {new Date(p.unlockAt * 1000).toLocaleString()}
                      <small>
                        {p.closed
                          ? "Closed"
                          : p.unlockAt > app.now
                            ? countdown(p.unlockAt - app.now)
                            : "Unlocked · earns at 1×"}
                      </small>
                    </td>
                    <td>
                      {app.rewardDecimals === undefined
                        ? "—"
                        : formatUnits(p.earned, app.rewardDecimals)}
                    </td>
                    <td>
                      <button
                        className="text-button"
                        disabled={!!busy || p.closed || p.earned === 0n}
                        onClick={() =>
                          void run("Claim", async () => {
                            await app.sdk.claim(p.id);
                            await app.refreshStaking();
                            setMessage("Rewards claimed.");
                          })
                        }
                      >
                        Claim
                      </button>
                      <button
                        className="text-button"
                        disabled={!!busy || p.closed || p.unlockAt > app.now}
                        onClick={() =>
                          void run("Withdraw", async () => {
                            await app.sdk.withdraw(p.id);
                            await app.refreshStaking();
                            setMessage("Position withdrawn.");
                          })
                        }
                      >
                        Withdraw
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-compact">
            <p>
              {stakingBlock === undefined
                ? "Position history is not configured. Set the staking deployment block."
                : "No positions for this wallet."}
            </p>
          </div>
        )}
      </section>
    );
  }
  return (
    <>
    {alertMessage && <AlertModal message={alertMessage} close={() => setAlertMessage("")} />}
    {message && <AlertModal message={message} close={() => setMessage("")} />}
    <main id="main" className="app-layout">
      <aside className={`sidebar ${sideOpen ? "expanded" : ""} ${retracted ? "retracted" : ""}`}>
        <div className="sidebar-caption">
          <div className="sidebar-caption-text">
            <span className="eyebrow">YOUR PRIVATE BOX</span>
            <span className="box-no">Nº 01</span>
          </div>
          <button
            type="button"
            className="sidebar-retract-btn"
            onClick={toggleRetract}
            aria-label={retracted ? "Expand sidebar" : "Collapse sidebar"}
            title={retracted ? "Expand sidebar" : "Collapse sidebar"}
          >
            {retracted ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>
        </div>
        <nav aria-label="Application navigation">
          {navItems.map((n) => (
            <RouteLink
              key={n.id}
              to={n.path}
              className={`side-link ${n.id === current.id ? "selected" : ""}`}
              title={n.name}
            >
              <n.icon size={18} />
              <span className="side-link-text">{n.name}</span>
            </RouteLink>
          ))}
          <span className="side-link coming-soon" title="Lending — coming soon">
            <Clock size={18} />
            <span className="side-link-text">Lending — coming soon</span>
          </span>
        </nav>
        <div className="sidebar-bottom">
          <div className="side-motto">
            <Logo compact />
            <p>
              The position is yours.
              <br />
              <em>So is the privacy.</em>
            </p>
          </div>
          <Socials />
          <div className="side-legal">
            <RouteLink to="/whitepaper">Whitepaper</RouteLink>
            <RouteLink to="/roadmap">Roadmap</RouteLink>
            <RouteLink to="/legal/terms">Terms</RouteLink>
          </div>
          <RouteLink to="/" className="return-link" title="Back to the overture">
            <span className="side-link-text">Back to the overture</span>
            <ArrowUpRight size={13} />
          </RouteLink>
        </div>
      </aside>
      <div className="app-content">
        <div className="app-topline">
          <div className="topline-left">
            <button
              className="mobile-sidebar"
              aria-label="Toggle application navigation"
              aria-expanded={sideOpen}
              onClick={() => {
                if (typeof window !== "undefined" && window.innerWidth <= 700) {
                  setSideOpen((v) => !v);
                } else {
                  toggleRetract();
                }
              }}
              title={retracted ? "Expand sidebar" : "Collapse sidebar"}
            >
              <Menu size={18} />
            </button>
            <span className="breadcrumbs">
              PRIVATE BOX <ChevronRight size={12} />
              {current.name}
            </span>
          </div>
          <div className="app-topline-actions">
            <div className="curtain-switch" role="group" aria-label="Choose Curtain vault">
              <span className="curtain-switch-label">CURTAIN</span>
              <button
                type="button"
                className={mode === "v2" ? "active" : ""}
                aria-pressed={mode === "v2"}
                onClick={() => switchCurtain("v2")}
                title="Use Curtain II with flexible amounts"
              >
                V2
              </button>
              <button
                type="button"
                className={mode === "v3" ? "active" : ""}
                aria-pressed={mode === "v3"}
                onClick={() => switchCurtain("v3")}
                title="Use Curtain III with fixed denominations"
              >
                V3
              </button>
            </div>
            <button className="wallet-button" onClick={connect}>
              <Wallet size={16} />
              {wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "Connect wallet"}
            </button>
          </div>
        </div>
        <div className="dashboard-body">
          <div className="dashboard-heading">
            <div>
              <p className="eyebrow">DRAW THE CURTAIN</p>
              <h1>{current.name}</h1>
              <p>Private swaps. Considered timing. Rewards for your next act.</p>
            </div>
            <button
              className="text-button"
              disabled={!!busy}
              onClick={() => {
                void app.refresh();
                void app.refreshActivity(true);
                void app.refreshStaking();
              }}
            >
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
          {!wallet && <Note>Connect your wallet to see balances, swaps and rewards.</Note>}
          {app.offline && <Note>{OFFLINE_MESSAGE}</Note>}
          {busy && (
            <p role="status" className="notice">
              {busy} in progress. Your wallet may ask for approval and then a transaction.
            </p>
          )}
          {current.id === "overview" && (
            <>
              <div className="overview-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Your balances</h2>
                    <span className="pill">Raw token units</span>
                  </div>
                  <div className="asset-table">
                    {app.tokens.map((t) => (
                      <div className="asset-row" key={t.symbol}>
                        <div>
                          <Token token={t} />
                          <span>
                            <strong>{t.symbol}</strong>
                            <small>{t.name}</small>
                          </span>
                        </div>
                        <span>{balanceText(t)}</span>
                        <RouteLink to="/app/swap">
                          Swap <ArrowUpRight size={14} />
                        </RouteLink>
                      </div>
                    ))}
                    {!app.tokens.length && (
                      <p className="empty-compact">
                        Token balances are waiting for network configuration.
                      </p>
                    )}
                  </div>
                </section>
                <section className="panel next-act">
                  <p className="eyebrow">THE NEXT ACT</p>
                  <h2>On your terms.</h2>
                  <RouteLink to="/app/swap">
                    Swap privately <ArrowUpRight size={16} />
                  </RouteLink>
                  <RouteLink to="/app/stake">
                    Earn up to 2× rewards <ArrowUpRight size={16} />
                  </RouteLink>
                  <p>Lending coming soon.</p>
                </section>
              </div>
              <section className="panel v2-section">
                <div className="panel-heading">
                  <h2>Open swaps</h2>
                </div>
                {rows(true)}
              </section>
              <div className="v2-section">
                {stakeToken ? positionTable() : <Note>Staking opens when $CRTN launches.</Note>}
              </div>
            </>
          )}
          {current.id === "swap" && (
            <div className="workspace-grid">
              <section className="panel form-panel">
                <div className="panel-heading">
                  <h2>Swap privately</h2>
                </div>
                <label className="field-label" htmlFor="swap-from">
                  From
                </label>
                {picker("swap-from", from, "from")}
                <label className="field-label" htmlFor="swap-amount">
                  Amount
                </label>
                <div className="amount-input">
                  <input
                    id="swap-amount"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                  />
                  <button
                    className="text-button"
                    disabled={input?.balance === undefined}
                    onClick={() =>
                      input &&
                      input.balance !== undefined &&
                      setAmount(formatUnits(input.balance, input.decimals))
                    }
                  >
                    Max
                  </button>
                </div>
                {(() => {
                  // #6: pieces are random-sized on purpose, so the nudge doesn't apply there.
                  if (!features.roundNudge || usePieces || !input) return null;
                  let raw: bigint;
                  try {
                    raw = rawAmount(amount, input.decimals);
                  } catch {
                    return null;
                  }
                  const tip = roundSuggestions(raw, input.decimals, input.balance);
                  if (!tip) return null;
                  const label = (v: string) =>
                    `${Number(v).toLocaleString(undefined, { maximumFractionDigits: input.decimals })} ${from}`;
                  return (
                    <div className="v2-round-nudge">
                      <span className="field-help">
                        Deposits are public, and an exact amount like this is easy to match to its
                        payout. A round amount blends in with other swaps.
                      </span>
                      <div>
                        <button className="text-button" onClick={() => setAmount(tip.lower)}>
                          Use {label(tip.lower)}
                        </button>
                        {tip.higher && (
                          <button className="text-button" onClick={() => setAmount(tip.higher!)}>
                            Use {label(tip.higher)}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}
                <div className="field-header-row">
                  <label className="field-label" htmlFor="swap-to">
                    To (Recipient Asset)
                  </label>
                  <span className="field-hint">{app.tokens.length} verified assets</span>
                </div>
                <div className="quick-category-pills">
                  {TOKEN_CATEGORIES.map((cat) => {
                    const active = (output?.category || "bluechip") === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        className={`quick-pill ${active ? "active" : ""}`}
                        onClick={() => {
                          setSelectedCategory(cat.id);
                          setSearchQuery("");
                          setPickingTarget("to");
                        }}
                      >
                        {cat.label}
                      </button>
                    );
                  })}
                </div>
                {picker("swap-to", to, "to")}
                <label className="field-label" htmlFor="swap-recipient">
                  {useSplit ? "Recipients" : "Recipient"}
                </label>
                {splitAvailable && (
                  <div className="segmented">
                    {[false, true].map((v) => (
                      <button
                        key={String(v)}
                        aria-pressed={splitOn === v}
                        onClick={() => setSplitOn(v)}
                      >
                        {v ? "Split between several" : "One recipient"}
                      </button>
                    ))}
                  </div>
                )}
                {stealthAvailable && (
                  <div className="segmented">
                    {[false, true].map((v) => (
                      <button
                        key={String(v)}
                        aria-pressed={stealthMode === v}
                        onClick={() => setStealthMode(v)}
                      >
                        {v ? "Stealth address" : "Wallet address"}
                      </button>
                    ))}
                  </div>
                )}
                {useSplit ? (
                  <>
                    {splitTo.map((value, k) => (
                      <div key={k} className="v2-split-row">
                        <input
                          id={k === 0 ? "swap-recipient" : undefined}
                          aria-label={`Recipient ${k + 1}`}
                          value={value}
                          onChange={(e) =>
                            setSplitTo((list) => list.map((v, i) => (i === k ? e.target.value : v)))
                          }
                          placeholder={
                            useStealth
                              ? `Recipient ${k + 1}: st:eth:0x… or a wallet with stealth keys`
                              : `Recipient ${k + 1}: 0x…`
                          }
                          spellCheck={false}
                          autoComplete="off"
                        />
                        {splitTo.length > 2 && (
                          <button
                            className="text-button"
                            aria-label={`Remove recipient ${k + 1}`}
                            onClick={() => setSplitTo((list) => list.filter((_, i) => i !== k))}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                    {splitTo.length < maxSplit && (
                      <button
                        className="text-button"
                        onClick={() => setSplitTo((list) => [...list, ""])}
                      >
                        + Add recipient
                      </button>
                    )}
                    <div className="segmented">
                      {(["random", "equal"] as const).map((m) => (
                        <button
                          key={m}
                          aria-pressed={splitMode === m}
                          onClick={() => setSplitMode(m)}
                        >
                          {m === "random" ? "Random amounts" : "Equal amounts"}
                        </button>
                      ))}
                    </div>
                    {splitProblem && amount ? (
                      <button className="warning-link" onClick={() => setAlertMessage(splitProblem)}>
                        Review recipient warning
                      </button>
                    ) : null}
                    <span className="field-help">
                      {splitMode === "random"
                        ? "Curtain picks a random share for each recipient, so none of the amounts matches your deposit."
                        : "Each recipient gets the same share."}{" "}
                      Everyone is paid in the same transaction.
                      {useStealth
                        ? " Each recipient gets their own brand-new stealth address, with its own small delivery fee."
                        : ""}
                    </span>
                  </>
                ) : useStealth ? (
                  <>
                    <input
                      id="swap-recipient"
                      value={stealthInput}
                      onChange={(e) => setStealthInput(e.target.value)}
                      placeholder="st:eth:0x… or the receiver's 0x… wallet"
                      spellCheck={false}
                      autoComplete="off"
                    />
                    {stealthMeta ? (
                      <span className="field-help">
                        Receiver's stealth keys found. This swap goes to a brand-new address that
                        only they can find and spend from.
                      </span>
                    ) : stealthNote ? (
                      <button className="warning-link" onClick={() => setAlertMessage(stealthNote)}>
                        Review receiver warning
                      </button>
                    ) : (
                      <span className="field-help">
                        Paste the stealth meta-address the receiver gave you, or their wallet if
                        they've published stealth keys.
                      </span>
                    )}
                    <span className="field-help">
                      A small fee, shown in the quote, puts gas on the new address so the receiver
                      can move the tokens without linking it to their main wallet.
                    </span>
                  </>
                ) : (
                  <>
                    <input
                      id="swap-recipient"
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      placeholder="0x…"
                    />
                    <button className="text-button" onClick={() => setRecipient(wallet)}>
                      Use my wallet
                    </button>
                    {features.freshWallet && (
                      <FreshWallet
                        onUse={(a) => setRecipient(a)}
                        onSaved={(a, saved) => setFreshWallet({ address: a, saved })}
                      />
                    )}
                    <span className="field-help">
                      Sending to a fresh address gives you the most privacy.
                    </span>
                  </>
                )}
                {linkWarnings.length > 0 && (
                  <div className="v2-link-warnings">
                    <button className="warning-link" onClick={() => setAlertMessage(linkWarnings.join(" "))}>
                      Review privacy warning
                    </button>
                    <span className="field-help">A fresh or stealth address keeps the payout separate from you.</span>
                  </div>
                )}
                <p className="field-label">Timing</p>
                <div className="segmented">
                  {[false, true].map((v) => (
                    <button
                      key={String(v)}
                      aria-pressed={delayed === v}
                      onClick={() => setDelayed(v)}
                    >
                      {v ? "Private delay" : "Instant"}
                    </button>
                  ))}
                </div>
                {delayed && features.delayPresets && (
                  <>
                    <div className="segmented v2-delay-presets">
                      {(["quick", "better", "best", "custom"] as const).map((p) => (
                        <button
                          key={p}
                          aria-pressed={delayPreset === p}
                          onClick={() => {
                            setDelayPreset(p);
                            if (p !== "custom") setPresetSeconds(presetWindow(p, app.maxDelay));
                          }}
                        >
                          {p === "custom" ? "Custom" : DELAY_PRESETS[p].label}
                          {p !== "custom" && <small>{DELAY_PRESETS[p].range}</small>}
                        </button>
                      ))}
                    </div>
                    {usePresets && (
                      <span className="field-help">
                        This swap gets a window of {aboutDuration(delaySeconds)}, picked at random
                        inside the preset so delays don't all look the same.
                      </span>
                    )}
                  </>
                )}
                {delayed && (
                  <>
                    {!usePresets && (
                      <>
                        <label className="field-label" htmlFor="swap-delay">
                          Delay window
                        </label>
                        <select
                          id="swap-delay"
                          value={delay}
                          onChange={(e) => setDelay(e.target.value)}
                        >
                          {[
                            [3600, "1 hour"],
                            [21600, "6 hours"],
                            [86400, "1 day"],
                            [604800, "7 days"],
                            [2592000, "30 days"],
                            [15552000, "180 days"],
                          ].map(([s, label]) => (
                            <option key={s} value={s} disabled={Number(s) > app.maxDelay}>
                              {label}
                            </option>
                          ))}
                          <option value="custom">Custom</option>
                        </select>
                        {delay === "custom" && (
                          <>
                            <label className="field-label" htmlFor="custom-delay">
                              Window in seconds (maximum {app.maxDelay})
                            </label>
                            <input
                              id="custom-delay"
                              type="number"
                              min={1}
                              max={app.maxDelay}
                              value={customDelay}
                              onChange={(e) => setCustomDelay(e.target.value)}
                            />
                          </>
                        )}
                      </>
                    )}
                    <span className="field-help">
                      Curtain pays out at a random time inside this window. Longer windows are more
                      private.
                    </span>
                    {piecesAvailable && (
                      <>
                        <div className="segmented">
                          {[false, true].map((v) => (
                            <button
                              key={String(v)}
                              aria-pressed={piecesOn === v}
                              onClick={() => setPiecesOn(v)}
                            >
                              {v ? "Deliver in pieces" : "One delivery"}
                            </button>
                          ))}
                        </div>
                        {usePieces && (
                          <>
                            <label className="field-label" htmlFor="piece-count">
                              Pieces
                            </label>
                            <select
                              id="piece-count"
                              value={pieceCount}
                              onChange={(e) => setPieceCount(Number(e.target.value))}
                            >
                              {[2, 3, 4, 5].map((n) => (
                                <option key={n} value={n}>
                                  {n} pieces
                                </option>
                              ))}
                            </select>
                            <span className="field-help">
                              Your swap becomes {pieceCount} separate private swaps of random sizes,
                              each delivered at its own random time in this window. Each piece has
                              its own escape ticket, so every piece stays refundable on its own.
                              Your wallet asks you to approve once and confirm {pieceCount}{" "}
                              deposits.
                            </span>
                          </>
                        )}
                      </>
                    )}
                  </>
                )}
                <label className="field-label" htmlFor="slippage">
                  Slippage
                </label>
                <select
                  id="slippage"
                  value={slippage}
                  onChange={(e) => setSlippage(Number(e.target.value))}
                >
                  {[50, 100, 200].map((bps) => (
                    <option key={bps} value={bps}>
                      {bps / 100}%
                    </option>
                  ))}
                </select>
                <div className="fee-breakdown" aria-live="polite">
                  {quoting && <p>Updating quote…</p>}
                  {quote && output && (
                    <>
                      <div>
                        <span>You receive ≈</span>
                        <strong>
                          {formatUnits(BigInt(quote.expectedOut), output.decimals)} {to}
                        </strong>
                      </div>
                      <div>
                        <span>Minimum</span>
                        <span>
                          {formatUnits(BigInt(quote.minOutSuggested), output.decimals)} {to}
                        </span>
                      </div>
                      <div>
                        <span>Route</span>
                        <span>{quote.venue}</span>
                      </div>
                      <div>
                        <span>Protocol fee</span>
                        <span>0.20%</span>
                      </div>
                      <div>
                        <span>Keeper fee</span>
                        <span>0.05%</span>
                      </div>
                      {quote.stealthFee && (
                        <div>
                          <span>
                            Stealth delivery fee
                            {quote.splitParts ? ` (×${quote.splitParts})` : ""}
                          </span>
                          <span>
                            {formatUnits(BigInt(quote.stealthFee), output.decimals)} {to}
                          </span>
                        </div>
                      )}
                      {quote.splitParts && (
                        <div>
                          <span>Split</span>
                          <span>
                            {quote.splitParts} recipients ·{" "}
                            {splitMode === "random" ? "random amounts" : "equal amounts"}
                          </span>
                        </div>
                      )}
                      {!quote.available && (
                        <p>
                          {quote.splitParts && BigInt(quote.marketOut) > 0n
                            ? "This amount is too small to split. Try a larger amount or fewer recipients."
                            : quote.stealthFee && BigInt(quote.marketOut) > 0n
                              ? "This amount is too small to cover stealth delivery. Try a larger amount."
                              : "No liquidity for this pair right now"}
                        </p>
                      )}
                    </>
                  )}
                </div>
                {showPool && waiting && input && (
                  <Note>
                    {(() => {
                      const key = Object.keys(waiting.byToken).find(
                        (k) => k.toLowerCase() === input.address.toLowerCase(),
                      ) as Address | undefined;
                      const n = key ? waiting.byToken[key]! : 0;
                      if (n === 0)
                        return `No other ${from} deposits are waiting right now. A private delay gives others time to join, so your payout is harder to single out.`;
                      const crowd = `${n} ${from} deposit${n === 1 ? " is" : "s are"} waiting to be paid out right now`;
                      return delaySeconds > 0
                        ? `${crowd}. Yours would join them until its random payout time.`
                        : `${crowd}. Instant swaps pay out within seconds; a private delay lets your deposit hide among them.`;
                    })()}
                  </Note>
                )}
                {features.privacyScore && input && (
                  <PrivacyScore
                    delaySeconds={delaySeconds}
                    pieces={usePieces}
                    recipient={recipientKind}
                    roundAmount={(() => {
                      if (usePieces) return true; // pieces are random-sized on purpose
                      try {
                        return (
                          roundSuggestions(rawAmount(amount, input.decimals), input.decimals) ===
                          null
                        );
                      } catch {
                        return true; // no amount yet: don't count it against the swap
                      }
                    })()}
                    randomSplit={(useSplit && splitMode === "random") || usePieces}
                  />
                )}
                <button
                  className="button gold v2-primary"
                  disabled={
                    !!busy ||
                    !wallet ||
                    !app.vault ||
                    !quote?.available ||
                    quoting ||
                    app.offline ||
                    (useSplit ? !!splitProblem : useStealth ? !stealthMeta : freshUnsaved)
                  }
                  onClick={() => void swap()}
                >
                  Swap privately <ArrowUpRight size={16} />
                </button>
              </section>
              <div>
                <Note>
                  Your deposit shows your wallet, token and amount. Longer delays and fresh
                  recipient addresses give more privacy.
                </Note>
                <Note>
                  If the price falls below your minimum, the swap waits for a better price. After
                  the deadline, use your escape ticket to refund.
                </Note>
                {latest && (
                  <section className="panel form-panel v2-section">
                    <h2>Your escape ticket</h2>
                    <p>
                      Keep this file. If Curtain is ever unavailable, it lets you take your deposit
                      back.
                    </p>
                    <button className="button gold" onClick={() => download(latest)}>
                      <Download size={16} />
                      Download escape ticket
                    </button>
                    <p className="field-help">This file is private. Store it somewhere safe.</p>
                    {link(latest.depositTx!, "Deposit transaction")}
                    {rows()}
                  </section>
                )}
              </div>
            </div>
          )}
          {current.id === "stake" &&
            (!stakeToken ? (
              <section className="panel empty-compact">
                <h3>The next act awaits.</h3>
                <p>Staking opens when $CRTN launches.</p>
              </section>
            ) : (
              <>
                <section className="panel form-panel">
                  <h2>Earn up to 2× rewards</h2>
                  {!staking && <Note>Staking is not configured.</Note>}
                  <label className="field-label" htmlFor="stake-amount">
                    Amount · CRTN{" "}
                    {app.stakeBalance !== undefined && app.stakeDecimals !== undefined
                      ? `· Balance ${formatUnits(app.stakeBalance, app.stakeDecimals)}`
                      : ""}
                  </label>
                  <input
                    id="stake-amount"
                    inputMode="decimal"
                    value={stakeAmount}
                    onChange={(e) => setStakeAmount(e.target.value)}
                  />
                  <div className="v2-tiers">
                    {TIERS.map((t) => (
                      <button
                        key={t.tier}
                        className="panel"
                        aria-pressed={tier === t.tier}
                        onClick={() => setTier(t.tier)}
                      >
                        <strong>{t.days} days</strong>
                        <span>{t.multiplier}× rewards</span>
                      </button>
                    ))}
                  </div>
                  <button
                    className="button gold"
                    disabled={
                      !!busy ||
                      !wallet ||
                      !staking ||
                      app.stakeDecimals === undefined ||
                      !stakeAmount ||
                      stakingBlock === undefined
                    }
                    onClick={() =>
                      void run("Stake", async () => {
                        const raw = rawAmount(stakeAmount, app.stakeDecimals!);
                        if (app.stakeBalance === undefined || raw > app.stakeBalance)
                          throw new Error("Your CRTN balance is too low.");
                        await app.sdk.stake(stakeToken!, raw, tier);
                        setStakeAmount("");
                        await app.refreshStaking();
                        setMessage("Your position is staked.");
                      })
                    }
                  >
                    Stake
                  </button>
                  <span
                    className="field-help"
                    title="After unlocking, a position earns at 1×. Withdraw and restake to earn a multiplier again."
                  >
                    After unlocking, a position earns at 1×. Withdraw and restake to earn a
                    multiplier again.
                  </span>
                </section>
                <div className="v2-section">{positionTable()}</div>
              </>
            ))}
          {current.id === "receive" && (
            <StealthReceive
              wallet={wallet}
              tokens={app.tokens}
              showKeys={features.stealthKeys}
              showInbox={features.stealthInbox}
              busy={busy}
              run={run}
              setMessage={setMessage}
            />
          )}
          {current.id === "activity" && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Your swaps & tickets</h2>
                <button
                  className="text-button"
                  disabled={!wallet || !!busy}
                  onClick={() => importRef.current?.click()}
                >
                  Import ticket
                </button>
                <input
                  ref={importRef}
                  type="file"
                  accept="application/json,.json"
                  className="v2-file-input"
                  aria-label="Import escape ticket"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void importTicket(file);
                    e.target.value = "";
                  }}
                />
              </div>
              {rows()}
            </section>
          )}
        </div>
      </div>
      {tokenModal()}
    </main>
    </>
  );
}
