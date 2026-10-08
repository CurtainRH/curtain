import { ClientOnly } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { RainbowKitProvider, darkTheme, useConnectModal } from "@rainbow-me/rainbowkit";
import { WagmiProvider, useAccount } from "wagmi";
import { formatUnits, isAddress, parseUnits, type Address } from "viem";
import { ArrowRight, Check, ChevronDown, LoaderCircle, ShieldCheck } from "lucide-react";
import { wagmiConfig } from "@/lib/wagmi";
import { chain, curtainMode, ensureChain, errorMessage, type CurtainMode } from "@/curtain/integration";
import { downloadFile } from "@/curtain/domain";
import { useCurtain, type TokenData } from "@/curtain/useCurtain";
import type { SavedTicket } from "@/curtain/integration";
import "./swap.css";

function SwapExperience() {
  const { address: account } = useAccount();
  const { openConnectModal } = useConnectModal();
  const wallet = account ?? "";
  const app = useCurtain(wallet);
  const [from, setFrom] = useState("USDG");
  const [to, setTo] = useState("NVDA");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [delay, setDelay] = useState("3600");
  const [quote, setQuote] = useState<string>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<SavedTicket>();

  const input = app.tokens.find((token) => token.symbol === from);
  const output = app.tokens.find((token) => token.symbol === to);
  const isV3 = curtainMode() === "v3";
  const recipientAddress = recipient.trim() || wallet;
  const canSwap = !!wallet && !!input && !!output && !!amount && !!recipientAddress;

  const tokenOptions = useMemo(
    () => app.tokens.filter((token) => token.symbol !== to),
    [app.tokens, to],
  );
  const outputOptions = useMemo(
    () => app.tokens.filter((token) => token.symbol !== from),
    [app.tokens, from],
  );

  useEffect(() => {
    setQuote(undefined);
    setError("");
  }, [from, to, amount]);

  function rawAmount(value: string, decimals: number) {
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error("Enter a valid amount.");
    const raw = parseUnits(value, decimals);
    if (raw <= 0n) throw new Error("Enter an amount greater than zero.");
    return raw;
  }

  async function getQuote() {
    if (!input || !output) return;
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
    if (!input || !output || !canSwap) return;
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
          <span className="swap-brand-mark">C</span>
          <span>Curtain</span>
        </a>
        <a className="swap-header-link" href="https://curtainrh.com/app">Full dashboard <ArrowRight size={14} /></a>
      </header>
      <section className="swap-card" aria-labelledby="swap-title">
        <div className="swap-intro">
          <span className="swap-eyebrow"><ShieldCheck size={15} /> PRIVATE SWAP</span>
          <h1 id="swap-title">Swap simply.</h1>
          <p>Choose what you send, what you receive, and where it should arrive.</p>
        </div>
        {!wallet ? (
          <button className="swap-primary" onClick={() => openConnectModal?.()}>
            Connect wallet <ArrowRight size={17} />
          </button>
        ) : (
          <>
            <div className="swap-wallet-pill">Connected: {wallet.slice(0, 6)}…{wallet.slice(-4)}</div>
            <div className="swap-fields">
              <TokenSelect label="You send" value={from} options={tokenOptions} onChange={setFrom} token={input} />
              <div className="swap-arrow"><ArrowRight size={17} /></div>
              <TokenSelect label="You receive" value={to} options={outputOptions} onChange={setTo} token={output} />
            </div>
            <label className="swap-label" htmlFor="simple-amount">Amount</label>
            <div className="swap-amount-row">
              <input id="simple-amount" className="swap-input" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <span>{from}</span>
            </div>
            <label className="swap-label" htmlFor="simple-recipient">Recipient <small>optional</small></label>
            <input id="simple-recipient" className="swap-input" placeholder={`${wallet.slice(0, 6)}…${wallet.slice(-4)} (your wallet)`} value={recipient} onChange={(e) => setRecipient(e.target.value)} />
            <p className="swap-help">Leave this blank to send the result to your connected wallet.</p>
            <label className="swap-label" htmlFor="simple-delay">Delivery</label>
            <select id="simple-delay" className="swap-input" value={delay} onChange={(e) => setDelay(e.target.value)}>
              <option value="0">Instant</option>
              <option value="3600">Within 1 hour</option>
              <option value="86400">Within 1 day</option>
              <option value="604800">Within 7 days</option>
            </select>
            {isV3 && <p className="swap-help swap-note">Curtain III uses approved fixed denominations. If this amount is not approved, switch to Curtain II in the full dashboard.</p>}
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
          </>
        )}
        <p className="swap-footnote">Robinhood Chain · You keep control of your wallet</p>
      </section>
    </main>
  );
}

function TokenSelect({ label, value, options, onChange, token }: { label: string; value: string; options: TokenData[]; onChange: (value: string) => void; token?: TokenData | undefined }) {
  return (
    <label className="swap-token-select"><span>{label}</span><div><span className="swap-token-symbol">{token?.symbol || value}</span><ChevronDown size={15} /></div><select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>{options.map((item) => <option key={item.symbol} value={item.symbol}>{item.symbol} — {item.name}</option>)}</select></label>
  );
}

export default function SwapApp() {
  return <ClientOnly fallback={<div className="swap-loading" />}><WagmiProvider config={wagmiConfig}><RainbowKitProvider theme={darkTheme({ accentColor: "#c5a059", accentColorForeground: "#080c14", borderRadius: "medium" })}><SwapExperience /></RainbowKitProvider></WagmiProvider></ClientOnly>;
}
