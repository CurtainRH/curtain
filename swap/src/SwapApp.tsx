import { useEffect, useMemo, useState } from "react";
import { RainbowKitProvider, darkTheme, useConnectModal } from "@rainbow-me/rainbowkit";
import { WagmiProvider, useAccount } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createWalletClient, custom, formatUnits, isAddress, parseAbi, parseUnits, type Address } from "viem";
import { ArrowDownUp, ArrowRight, Check, ChevronDown, Clock, HelpCircle, Home, LoaderCircle, Rewind, Search, X } from "lucide-react";
import { wagmiConfig } from "./wagmi";
import { chain, client, ensureChain, errorMessage, provider, publicClient, v3Vault } from "./curtain/integration";
import { downloadFile } from "./curtain/domain";
import { useCurtain, type TokenData } from "./curtain/useCurtain";
import type { SavedTicket } from "./curtain/integration";
import { POOL_V2_CLIENT_ENABLED } from "./curtain/routes";
import { pendingPoolV4Notes, poolV4Quote, poolV4Swap, PoolV4FallbackError, recoverPoolV4Note, type PendingPoolV4Note } from "./curtain/poolV4";
import "@rainbow-me/rainbowkit/styles.css";
import "./swap.css";

const queryClient = new QueryClient();

function SwapExperience() {
  const { address: account } = useAccount();
  const { openConnectModal } = useConnectModal();
  const wallet = account ?? "";
  const [routeMode, setRouteMode] = useState<"v2" | "v3" | "v4">("v2");
  const [modeChecking, setModeChecking] = useState(false);
  // Keep the shared token/balance data on V2. Route selection is only for
  // quotes and swap submission; changing it must not clear the token list and
  // restart the route detector (which can otherwise oscillate V2 <-> V3/V4).
  const app = useCurtain(wallet, "v2");
  const routeSdk = useMemo(
    () => client(wallet, routeMode === "v3" ? "v3" : "v2"),
    [wallet, routeMode],
  );
  const [from, setFrom] = useState("USDG");
  const [to, setTo] = useState("NVDA");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [delay, setDelay] = useState("0");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [limitOut, setLimitOut] = useState("");
  const [limitExpiry, setLimitExpiry] = useState("86400");
  const [quote, setQuote] = useState<string>();
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteRefresh, setQuoteRefresh] = useState(0);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState<{ kind: "success" | "error" | "info"; message: string }>();
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [pendingNotes, setPendingNotes] = useState<PendingPoolV4Note[]>([]);
  const [picker, setPicker] = useState<"from" | "to" | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(undefined), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function openRecovery() {
    setPendingNotes(pendingPoolV4Notes());
    setRecoveryOpen(true);
  }

  async function recoverNotes(notes = pendingNotes) {
    if (!wallet) {
      setToast({ kind: "error", message: "Connect a wallet with gas to submit the recovery transaction." });
      return;
    }
    const injected = provider();
    if (!injected) {
      setToast({ kind: "error", message: "Reconnect your wallet before recovering this note." });
      return;
    }
    try {
      await ensureChain();
      const walletClient = createWalletClient({ chain, transport: custom(injected), account: wallet as Address });
      for (const note of notes) {
        await recoverPoolV4Note({ publicClient, walletClient, note, onStatus: setBusy });
      }
      setPendingNotes(pendingPoolV4Notes());
      setToast({ kind: "success", message: "Private note recovered and delivered." });
    } catch (cause) {
      setPendingNotes(pendingPoolV4Notes());
      setToast({ kind: "error", message: errorMessage(cause) });
    } finally {
      setBusy("");
    }
  }

  const input = app.tokens.find((token) => token.symbol === from);
  const output = app.tokens.find((token) => token.symbol === to);
  const recipientAddress = recipient.trim() || wallet;
  const canSwap = !!wallet && !!input && !!output && !!amount && !!recipientAddress && !modeChecking;

  const tokenOptions = useMemo(
    () => app.tokens.filter((token) => token.symbol !== to),
    [app.tokens, to],
  );
  const outputOptions = useMemo(
    () => app.tokens.filter((token) => token.symbol !== from),
    [app.tokens, from],
  );

  function flipTokens() {
    setFrom(to);
    setTo(from);
    setAmount("");
  }

  useEffect(() => {
    setQuote(undefined);
  }, [from, to, amount]);

  useEffect(() => {
    if (quote && orderType === "market") setLimitOut(quote);
  }, [quote, orderType]);

  useEffect(() => {
    let active = true;
    const checkRoute = async () => {
      setModeChecking(true);
      if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount) || Number(amount) <= 0 || !input || !output) {
        if (active) {
          setRouteMode("v2");
          setModeChecking(false);
        }
        return;
      }
      let raw: bigint;
      try {
        raw = rawAmount(amount, input.decimals);
      } catch {
        if (active) {
          setRouteMode("v2");
          setModeChecking(false);
        }
        return;
      }
      let approved = false;
      try {
        approved = v3Vault
          ? await publicClient.readContract({
              address: v3Vault,
              abi: parseAbi(["function allowedAmount(address,uint256) view returns (bool)"]),
              functionName: "allowedAmount",
              args: [input.address, raw],
            })
          : false;
      } catch {
        approved = false;
      }
      const poolEligible = POOL_V2_CLIENT_ENABLED && orderType === "market" && Number(delay) === 0;
      if (poolEligible) {
        try {
          const poolQuote = await poolV4Quote({ tokenIn: input.address, tokenOut: output.address, amountIn: raw });
          if (active && poolQuote.available) {
            setRouteMode("v4");
            setModeChecking(false);
            return;
          }
        } catch {
          // If Pool V2 can't quote this pair, continue through the vault routes.
        }
      }
      if (active) {
        setRouteMode(approved ? "v3" : "v2");
        setModeChecking(false);
      }
    };
    void checkRoute();
    return () => {
      active = false;
    };
  }, [amount, delay, input, orderType, output]);

  function rawAmount(value: string, decimals: number) {
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error("Enter a valid amount.");
    const raw = parseUnits(value, decimals);
    if (raw <= 0n) throw new Error("Enter an amount greater than zero.");
    return raw;
  }

  useEffect(() => {
    let active = true;
    setQuote(undefined);
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount) || Number(amount) <= 0) {
      setQuoteLoading(false);
      return;
    }
    setQuoteLoading(true);
    if (modeChecking) return;
    if (!input || !output) {
      setQuoteLoading(false);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const raw = rawAmount(amount, input.decimals);
        const minOut = routeMode === "v4"
          ? (await poolV4Quote({ tokenIn: input.address, tokenOut: output.address, amountIn: raw })).minOut
          : (await routeSdk.quote(input.address, output.address, raw, 100)).minOutSuggested;
        if (!minOut) throw new Error("No quote is available for this pair right now.");
        if (active) setQuote(formatUnits(BigInt(minOut), output.decimals));
      } catch (e) {
        if (active) {
          setQuote(undefined);
          setToast({ kind: "error", message: errorMessage(e) });
        }
      } finally {
        if (active) setQuoteLoading(false);
      }
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [amount, input, modeChecking, output, quoteRefresh, routeMode, routeSdk]);

  function getQuote() {
    setQuoteRefresh((value) => value + 1);
  }

  async function swap() {
    if (!input || !output || !canSwap || modeChecking) return;
    try {
      setBusy("Preparing your swap");
      await ensureChain();
      if (!isAddress(recipientAddress)) throw new Error("Enter a valid recipient address.");
      const raw = rawAmount(amount, input.decimals);
      if (input.balance !== undefined && raw > input.balance)
        throw new Error("Your wallet balance is too low for this swap.");
      if (routeMode === "v4" && orderType === "market" && Number(delay) === 0) {
        const injected = provider();
        if (!injected) throw new Error("Reconnect your wallet before swapping.");
        const walletClient = createWalletClient({ chain, transport: custom(injected), account: wallet as Address });
        try {
          const target = quote ? rawAmount(quote, output.decimals) : 0n;
          if (target <= 0n) throw new PoolV4FallbackError("The pool quote expired. Refreshing your route.");
          const poolResult = await poolV4Swap({
            publicClient,
            walletClient,
            tokenIn: input.address,
            tokenOut: output.address,
            amountIn: raw,
            minOut: target,
            recipient: recipientAddress as Address,
            onStatus: setBusy,
          });
          setToast(poolResult.deliveryConfirmed
            ? { kind: "success", message: "Private swap complete. Your output was delivered to the recipient." }
            : { kind: "info", message: `Delivery transaction ${poolResult.unshieldTx.slice(0, 10)}… was submitted, but confirmation is delayed. Don’t submit again; your recovery note is saved.` });
          setAmount("");
          setQuote(undefined);
          void app.refresh();
          return;
        } catch (error) {
          if (!(error instanceof PoolV4FallbackError)) throw error;
          // Only this error type is emitted before funds enter the pool, so it is
          // safe to continue through the existing V3/V2 vault flow.
          let fallbackMode: "v2" | "v3" = "v2";
          if (v3Vault) {
            try {
              const approved = await publicClient.readContract({
                address: v3Vault,
                abi: parseAbi(["function allowedAmount(address,uint256) view returns (bool)"]),
                functionName: "allowedAmount",
                args: [input.address, raw],
              });
              if (approved) fallbackMode = "v3";
            } catch {
              // Keep the broadly compatible V2 fallback.
            }
          }
          setRouteMode(fallbackMode);
          setBusy(`Using the ${fallbackMode.toUpperCase()} privacy route`);
          const fallbackSdk = client(wallet, fallbackMode);
          const result = await fallbackSdk.quote(input.address, output.address, raw, 100);
          if (!result.available) throw new Error("No quote is available for this pair right now.");
          const target = BigInt(result.minOutSuggested);
          const saved = await fallbackSdk.swap({
            tokenIn: input.address,
            amountIn: raw,
            tokenOut: output.address,
            recipient: recipientAddress as Address,
            minOut: target,
            delaySeconds: 0,
            orderType: "market",
          });
          const ticket: SavedTicket = {
            createdAt: new Date().toISOString(), tokenIn: from,
            amountIn: formatUnits(raw, input.decimals), tokenOut: to,
            recipient: recipientAddress, delaySeconds: 0, chainId: chain.id,
            intentId: saved.intentId, ticket: saved.ticket, depositTx: saved.depositTx,
          };
          app.addTicket(ticket);
          downloadFile(`curtain-escape-ticket-${saved.ticket.depositId}.json`, ticket);
          setToast({ kind: "success", message: "Swap submitted. Your escape ticket was downloaded; keep it safe until delivery." });
          setAmount("");
          setQuote(undefined);
          void app.refresh();
          return;
        }
      }
      const swapSdk = routeSdk;
      const result = await swapSdk.quote(input.address, output.address, raw, 100);
      if (!result.available) throw new Error("No quote is available for this pair right now.");
      const target = orderType === "limit"
        ? rawAmount(limitOut, output.decimals)
        : BigInt(result.minOutSuggested);
      if (target <= 0n) throw new Error("Enter a minimum received amount for the limit order.");
      setBusy("Confirm in your wallet");
      const saved = await swapSdk.swap({
        tokenIn: input.address,
        amountIn: raw,
        tokenOut: output.address,
        recipient: recipientAddress as Address,
        minOut: target,
        delaySeconds: orderType === "limit" ? 0 : Number(delay),
        orderType,
        ...(orderType === "limit" ? { expiresInSeconds: Number(limitExpiry) } : {}),
      });
      const ticket: SavedTicket = {
        createdAt: new Date().toISOString(),
        tokenIn: from,
        amountIn: formatUnits(raw, input.decimals),
        tokenOut: to,
        recipient: recipientAddress,
        delaySeconds: Number(delay),
        chainId: chain.id,
        intentId: saved.intentId,
        ticket: saved.ticket,
        depositTx: saved.depositTx,
      };
      app.addTicket(ticket);
      downloadFile(`curtain-escape-ticket-${saved.ticket.depositId}.json`, ticket);
      setToast({ kind: "success", message: "Swap submitted. Your escape ticket was downloaded; keep it safe until delivery." });
      setAmount("");
      setQuote(undefined);
      void app.refresh();
    } catch (e) {
      setToast({ kind: "error", message: errorMessage(e) });
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="swap-page">
      <header className="swap-header">
        <a className="swap-brand" href="https://curtainrh.com" aria-label="Curtain home">
          <img src="/curtain-logo-exact.png" alt="" className="swap-curtain-logo" />
          <span>Curtain</span>
        </a>
        <a className="swap-header-link" href="https://curtainrh.com/app"><Home size={14} /> main</a>
      </header>
      <section className="swap-card" aria-labelledby="swap-title">
        <div className="swap-intro">
          <button type="button" className="swap-recovery-button" onClick={openRecovery} aria-label="Recover a private note" title="Recover a private note">
            <Rewind size={19} />
          </button>
          <h1 id="swap-title">Swap simply.</h1>
          <p>Choose what you send, what you receive, and where it should arrive...privately</p>
        </div>
        {!wallet ? (
          <button className="swap-primary" onClick={() => openConnectModal?.()}>
            Connect wallet <ArrowRight size={17} />
          </button>
        ) : (
          <>
            <div className="swap-wallet-pill">Connected: {wallet.slice(0, 6)}…{wallet.slice(-4)}</div>
            <div className="swap-pair-stack">
              <div className="swap-token-card">
                <div className="swap-card-label">From</div>
                <div className="swap-token-card-row">
                  <input id="simple-amount" className="swap-card-amount" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  <TokenSelect label="From token" onOpen={() => setPicker("from")} token={input} />
                </div>
                <div className="swap-card-foot"><span>{input?.balance === undefined ? "Balance —" : `Balance ${formatUnits(input.balance, input.decimals)}`}</span><button type="button" onClick={() => input?.balance !== undefined && setAmount(formatUnits(input.balance, input.decimals))}>Max</button></div>
              </div>
              <button className="swap-flip" type="button" onClick={flipTokens} aria-label="Switch tokens"><ArrowDownUp size={17} /></button>
              <div className="swap-token-card">
                <div className="swap-card-label">To</div>
                <div className="swap-token-card-row">
                  <span className="swap-card-amount swap-output-amount" aria-busy={quoteLoading}>
                    {quoteLoading ? <QuoteReel /> : <span className="swap-quote-value">{quote || "0"}</span>}
                  </span>
                  <TokenSelect label="To token" onOpen={() => setPicker("to")} token={output} />
                </div>
                <div className="swap-card-foot"><span role="status">{quoteLoading ? "Getting your quote…" : quote ? (orderType === "limit" ? "Current estimate" : "Estimated minimum received") : "Enter an amount to preview"}</span></div>
              </div>
            </div>
            <div className="swap-private-panel">
              <div><span className="swap-private-title"><Clock size={16} /> Order type</span><span className="swap-private-copy">Market now, or wait for your target price.</span></div>
              <select className="swap-private-select" value={orderType} onChange={(e) => setOrderType(e.target.value as "market" | "limit")} aria-label="Order type">
                <option value="market">Market swap</option>
                <option value="limit">Limit order</option>
              </select>
            </div>
            {orderType === "limit" ? (
              <div className="swap-limit-fields">
                <label className="swap-label" htmlFor="simple-limit-out">Minimum received <small>{to}</small></label>
                <input id="simple-limit-out" className="swap-input" inputMode="decimal" placeholder={quote || "0"} value={limitOut} onChange={(e) => setLimitOut(e.target.value)} />
                <label className="swap-label" htmlFor="simple-limit-expiry">Order expires</label>
                <select id="simple-limit-expiry" className="swap-private-select" value={limitExpiry} onChange={(e) => setLimitExpiry(e.target.value)} aria-label="Limit order expiry">
                  <option value="3600">In 1 hour</option><option value="21600">In 6 hours</option><option value="86400">In 1 day</option><option value="604800">In 7 days</option><option value="2592000">In 30 days</option>
                </select>
                <p className="swap-help">Your payout is released only when the current quote meets this minimum. If it does not, you can refund after expiry.</p>
              </div>
            ) : (
            <div className="swap-private-panel">
              <div><span className="swap-private-title"><Clock size={16} /> Delivery time</span><span className="swap-private-copy">Choose when your payout arrives.</span></div>
              <select id="simple-delay" className="swap-private-select" value={delay} onChange={(e) => setDelay(e.target.value)} aria-label="Delivery timing">
                <option value="0">Instant</option>
                <option value="3600">Within 1 hour</option>
                <option value="86400">Within 1 day</option>
                <option value="604800">Within 7 days</option>
              </select>
            </div>
            )}
            <label className="swap-label" htmlFor="simple-recipient">Recipient <small>optional</small></label>
            <input id="simple-recipient" className="swap-input" placeholder={`${wallet.slice(0, 6)}…${wallet.slice(-4)} (your wallet)`} value={recipient} onChange={(e) => setRecipient(e.target.value)} />
            <p className="swap-help">Leave this blank to send the result to your connected wallet.</p>
            {quote && <p className="swap-quote">{orderType === "limit" ? "Current estimate" : "Minimum received"}: <strong>{orderType === "limit" && limitOut ? limitOut : quote} {to}</strong></p>}
            <div className="swap-actions">
              <button className="swap-secondary" disabled={!canSwap || !!busy} onClick={() => void getQuote()}>Preview</button>
              <button className="swap-primary" disabled={!canSwap || !!busy} onClick={() => void swap()}>{busy ? <><LoaderCircle className="swap-spin" size={17} /> {busy}</> : <>Swap now <ArrowRight size={17} /></>}</button>
            </div>
            <p className="swap-dynamic-note">
              Dynamic privacy is enabled.
              <span className="swap-help-tooltip-wrap">
                <HelpCircle size={14} aria-label="What is dynamic privacy?" />
                <span className="swap-help-tooltip" role="tooltip">
                  For instant swaps, Curtain tries its shielded-pool route first. If unavailable—or for limit or delayed swaps—it falls back to fixed denominations or flexible amounts.
                </span>
              </span>
            </p>
          </>
        )}
        <p className="swap-footnote"><img src="/robinhood-logo.png" alt="" /> Robinhood Chain</p>
      </section>
      {picker && (
        <TokenPickerModal
          title={picker === "from" ? "Choose what you send" : "Choose what you receive"}
          options={picker === "from" ? tokenOptions : outputOptions}
          selected={picker === "from" ? from : to}
          close={() => setPicker(null)}
          choose={(symbol) => {
            if (picker === "from") setFrom(symbol);
            else setTo(symbol);
            setPicker(null);
          }}
        />
      )}
      {recoveryOpen && (
        <div className="swap-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setRecoveryOpen(false)}>
          <section className="swap-token-modal swap-recovery-modal" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
            <div className="swap-token-modal-heading">
              <div><span className="swap-card-label">ON THIS BROWSER</span><h2 id="recovery-title">Recover a private note</h2></div>
              <button type="button" className="swap-modal-close" onClick={() => setRecoveryOpen(false)} aria-label="Close recovery"><X size={19} /></button>
            </div>
            <p className="swap-help">Recovery secrets are saved in this browser’s local storage. Connect a wallet with gas to submit recovery; the note’s recipient stays unchanged. Clearing this site’s data removes saved recovery notes.</p>
            {pendingNotes.length ? (
              <div className="swap-recovery-list">
                {pendingNotes.map((note) => {
                  const token = app.tokens.find((item) => item.address.toLowerCase() === note.tokenOut.toLowerCase());
                  return (
                    <article className="swap-recovery-item" key={note.commitment}>
                      <div><strong>{formatUnits(BigInt(note.amount), token?.decimals ?? 18)} {token?.symbol ?? "token"}</strong><small>{note.commitment.slice(0, 10)}…{note.commitment.slice(-8)}</small></div>
                      <button type="button" className="swap-secondary" disabled={!!busy} onClick={() => void recoverNotes([note])}>{busy || "Recover"}</button>
                    </article>
                  );
                })}
              </div>
            ) : <p className="swap-empty">No pending private notes are saved in this browser.</p>}
            {busy && <p className="swap-recovery-status" role="status">{busy}</p>}
          </section>
        </div>
      )}
      {toast && <div className={`swap-toast swap-toast-${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}>{toast.message}<button type="button" aria-label="Dismiss notification" onClick={() => setToast(undefined)}><X size={15} /></button></div>}
    </main>
  );
}

function QuoteReel() {
  return (
    <span className="swap-quote-reel" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((column) => (
        <span key={column} className="swap-reel-column">
          <span className="swap-reel-strip" style={{ animationDelay: `${column * -0.17}s` }}>
            {"01234567890".split("").map((digit, index) => <span key={index}>{digit}</span>)}
          </span>
        </span>
      ))}
    </span>
  );
}

function TokenSelect({ label, onOpen, token }: { label: string; onOpen: () => void; token?: TokenData | undefined }) {
  return (
    <button type="button" className="swap-token-select" onClick={onOpen} aria-label={label}>
      <span className="swap-token-button-content">
        <img src={token?.logo} alt="" className="swap-token-logo" />
        <span className="swap-token-symbol">{token?.symbol || "Select"}</span>
      </span>
      <ChevronDown size={15} />
    </button>
  );
}

function TokenPickerModal({ title, options, selected, close, choose }: { title: string; options: TokenData[]; selected: string; close: () => void; choose: (symbol: string) => void }) {
  const [query, setQuery] = useState("");
  const filtered = options.filter((token) => `${token.symbol} ${token.name}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="swap-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section className="swap-token-modal" role="dialog" aria-modal="true" aria-labelledby="token-picker-title">
        <div className="swap-token-modal-heading"><div><span className="swap-card-label">CURTAIN ASSETS</span><h2 id="token-picker-title">{title}</h2></div><button type="button" className="swap-modal-close" onClick={close} aria-label="Close token picker"><X size={19} /></button></div>
        <label className="swap-token-search"><Search size={16} /><input autoFocus placeholder="Search token or company" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="swap-token-list">{filtered.map((token) => <button type="button" className={`swap-token-option ${token.symbol === selected ? "selected" : ""}`} key={token.symbol} onClick={() => choose(token.symbol)}><img src={token.logo} alt="" className="swap-token-logo" /><span><strong>{token.symbol}</strong><small>{token.name}</small></span>{token.symbol === selected && <Check size={16} />}</button>)}{!filtered.length && <p className="swap-empty">No matching assets.</p>}</div>
      </section>
    </div>
  );
}

export default function SwapApp() {
  return <QueryClientProvider client={queryClient}><WagmiProvider config={wagmiConfig}><RainbowKitProvider theme={darkTheme({ accentColor: "#c5a059", accentColorForeground: "#080c14", borderRadius: "medium" })}><SwapExperience /></RainbowKitProvider></WagmiProvider></QueryClientProvider>;
}
