import { useEffect, useMemo, useState } from "react";
import { RainbowKitProvider, darkTheme, useConnectModal } from "@rainbow-me/rainbowkit";
import { WagmiProvider, useAccount } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { formatUnits, isAddress, parseAbi, parseUnits, type Address } from "viem";
import { ArrowDownUp, ArrowRight, Check, ChevronDown, Clock, Home, LoaderCircle, Search, X } from "lucide-react";
import { wagmiConfig } from "./wagmi";
import { chain, ensureChain, errorMessage, publicClient, v3Vault } from "./curtain/integration";
import { downloadFile } from "./curtain/domain";
import { useCurtain, type TokenData } from "./curtain/useCurtain";
import type { SavedTicket } from "./curtain/integration";
import "@rainbow-me/rainbowkit/styles.css";
import "./swap.css";

const queryClient = new QueryClient();

function SwapExperience() {
  const { address: account } = useAccount();
  const { openConnectModal } = useConnectModal();
  const wallet = account ?? "";
  const [routeMode, setRouteMode] = useState<"v2" | "v3">("v2");
  const [modeChecking, setModeChecking] = useState(false);
  const app = useCurtain(wallet, routeMode);
  const [from, setFrom] = useState("USDG");
  const [to, setTo] = useState("NVDA");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [delay, setDelay] = useState("0");
  const [quote, setQuote] = useState<string>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<SavedTicket>();
  const [picker, setPicker] = useState<"from" | "to" | null>(null);

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
    setError("");
  }, [from, to, amount]);

  useEffect(() => {
    let active = true;
    const checkRoute = async () => {
      setModeChecking(true);
      if (!amount) {
        if (active) {
          setRouteMode("v2");
          setModeChecking(false);
        }
        return;
      }
      if (!input) {
        if (active) setModeChecking(false);
        return;
      }
      try {
        const raw = rawAmount(amount, input.decimals);
        const approved = v3Vault
          ? await publicClient.readContract({
              address: v3Vault,
              abi: parseAbi(["function allowedAmount(address,uint256) view returns (bool)"]),
              functionName: "allowedAmount",
              args: [input.address, raw],
            })
          : false;
        if (active) setRouteMode(approved ? "v3" : "v2");
      } catch {
        if (active) setRouteMode("v2");
      } finally {
        if (active) setModeChecking(false);
      }
    };
    void checkRoute();
    return () => {
      active = false;
    };
  }, [amount, input]);

  function rawAmount(value: string, decimals: number) {
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error("Enter a valid amount.");
    const raw = parseUnits(value, decimals);
    if (raw <= 0n) throw new Error("Enter an amount greater than zero.");
    return raw;
  }

  async function getQuote() {
    if (!input || !output || modeChecking) return;
    try {
      setError("");
      const raw = rawAmount(amount, input.decimals);
      const result = await app.sdk.quote(input.address, output.address, raw, 100);
      if (!result.available) throw new Error("No quote is available for this pair right now.");
      setQuote(formatUnits(BigInt(result.minOutSuggested), output.decimals));
    } catch (e) {
      setQuote(undefined);
      setError(errorMessage(e));
    }
  }

  async function swap() {
    if (!input || !output || !canSwap || modeChecking) return;
    try {
      setBusy("Preparing your swap");
      setError("");
      setSuccess(undefined);
      await ensureChain();
      if (!isAddress(recipientAddress)) throw new Error("Enter a valid recipient address.");
      const raw = rawAmount(amount, input.decimals);
      if (input.balance !== undefined && raw > input.balance)
        throw new Error("Your wallet balance is too low for this swap.");
      const result = await app.sdk.quote(input.address, output.address, raw, 100);
      if (!result.available) throw new Error("No quote is available for this pair right now.");
      setBusy("Confirm in your wallet");
      const saved = await app.sdk.swap({
        tokenIn: input.address,
        amountIn: raw,
        tokenOut: output.address,
        recipient: recipientAddress as Address,
        minOut: BigInt(result.minOutSuggested),
        delaySeconds: Number(delay),
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
      setSuccess(ticket);
      setAmount("");
      setQuote(undefined);
      void app.refresh();
    } catch (e) {
      setError(errorMessage(e));
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
                  <span className="swap-card-amount swap-output-amount">{quote || "0"}</span>
                  <TokenSelect label="To token" onOpen={() => setPicker("to")} token={output} />
                </div>
                <div className="swap-card-foot"><span>{quote ? "Estimated minimum received" : "Enter an amount to preview"}</span></div>
              </div>
            </div>
            <div className="swap-private-panel">
              <div><span className="swap-private-title"><Clock size={16} /> Delivery time</span><span className="swap-private-copy">Choose when your payout arrives.</span></div>
              <select id="simple-delay" className="swap-private-select" value={delay} onChange={(e) => setDelay(e.target.value)} aria-label="Delivery timing">
                <option value="0">Instant</option>
                <option value="3600">Within 1 hour</option>
                <option value="86400">Within 1 day</option>
                <option value="604800">Within 7 days</option>
              </select>
            </div>
            <label className="swap-label" htmlFor="simple-recipient">Recipient <small>optional</small></label>
            <input id="simple-recipient" className="swap-input" placeholder={`${wallet.slice(0, 6)}…${wallet.slice(-4)} (your wallet)`} value={recipient} onChange={(e) => setRecipient(e.target.value)} />
            <p className="swap-help">Leave this blank to send the result to your connected wallet.</p>
            {quote && <p className="swap-quote">Minimum received: <strong>{quote} {to}</strong></p>}
            {error && <div className="swap-error" role="alert">{error}</div>}
            {success ? (
              <div className="swap-success" role="status"><Check size={19} /><div><strong>Swap submitted.</strong><span>Your escape ticket was downloaded. Keep it safe until delivery.</span></div></div>
            ) : (
              <div className="swap-actions">
                <button className="swap-secondary" disabled={!canSwap || !!busy} onClick={() => void getQuote()}>Preview</button>
                <button className="swap-primary" disabled={!canSwap || !!busy} onClick={() => void swap()}>{busy ? <><LoaderCircle className="swap-spin" size={17} /> {busy}</> : <>Swap now <ArrowRight size={17} /></>}</button>
              </div>
            )}
            <p className="swap-dynamic-note">Dynamic privacy is enabled.</p>
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
    </main>
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
