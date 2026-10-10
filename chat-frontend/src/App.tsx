import { useEffect, useState, type FormEvent } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Archive, ArrowUp, Check, CircleAlert, CircleCheck, Download, LoaderCircle, X } from "lucide-react";
import { createPublicClient, createWalletClient, custom, formatUnits, http, isAddress, parseUnits, type Address } from "viem";
import { CurtainClient, DEFAULT_TOKENS, ROBINHOOD_CHAIN_TOKENS, type PendingTicket } from "@curtain/sdk";
import { chain } from "./wagmi";

type Action = { type: "swap"; amount: string; tokenIn: string; tokenOut: string; recipient?: string };
type Proposal = { action: Action; quote: { expectedOut: string; minOutSuggested: string; available: boolean; venue: string; minOut?: string }; recipient?: Address; route: { id: "v2" | "v3" | "v4"; label: string } };
type Message = { role: "user" | "assistant"; text: string; proposal?: Proposal; state?: "pending" | "done" | "denied" };
type Toast = { kind: "success" | "error"; title: string; message: string };
type Artifact = { kind: "Escape ticket" | "Pool V4 recovery note"; id: string; createdAt?: string | number; data: Record<string, unknown> };
const api = "/api/curtain";
const publicClient = createPublicClient({ chain, transport: http("/api/rpc", { retryCount: 2, timeout: 12_000 }) });
const storeTicket = (ticket: PendingTicket) => {
  const key = `curtain-chat-ticket:${ticket.intentId}`;
  localStorage.setItem(key, JSON.stringify({ ...ticket, createdAt: Date.now(), source: "chat" }));
};

function readArtifacts(): Artifact[] {
  const artifacts: Artifact[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    const isTicket = key.startsWith("curtain-chat-ticket:");
    const isNote = key.startsWith("curtain:v4:pending:");
    if (!isTicket && !isNote) continue;
    try {
      const data = JSON.parse(localStorage.getItem(key) || "null") as Record<string, unknown> | null;
      if (!data) continue;
      artifacts.push({
        kind: isTicket ? "Escape ticket" : "Pool V4 recovery note",
        id: isTicket ? key.slice("curtain-chat-ticket:".length) : key.slice("curtain:v4:pending:".length),
        createdAt: typeof data.createdAt === "string" || typeof data.createdAt === "number" ? data.createdAt : undefined,
        data,
      });
    } catch {
      // Ignore malformed local entries without hiding other recoverable artifacts.
    }
  }
  return artifacts.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}

function downloadArtifact(artifact: Artifact) {
  const blob = new Blob([JSON.stringify(artifact.data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `curtain-${artifact.kind === "Escape ticket" ? "escape-ticket" : "pool-v4-recovery-note"}-${artifact.id.slice(0, 12)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function artifactDate(value?: string | number) {
  if (value === undefined) return "Saved in this browser";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Saved in this browser" : date.toLocaleString();
}

function AnimatedText({ text }: { text: string }) {
  const [visible, setVisible] = useState("");
  const [streaming, setStreaming] = useState(true);
  useEffect(() => {
    let offset = 0;
    setVisible("");
    setStreaming(true);
    const timer = window.setInterval(() => {
      offset = Math.min(text.length, offset + 3);
      setVisible(text.slice(0, offset));
      if (offset >= text.length) { window.clearInterval(timer); setStreaming(false); }
    }, 13);
    return () => window.clearInterval(timer);
  }, [text]);
  return <>{visible}{streaming && visible.length < text.length && <span className="typing-cursor" aria-hidden="true"/>}</>;
}

export default function App() {
  const { address: account, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", text: "Tell me what you’d like to swap. Dynamic Privacy selects the available route for each request. I’ll prepare a proposal for you to review; nothing is sent until you approve it in your wallet." }]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function openArtifacts() {
    try {
      setArtifacts(readArtifacts());
      setArtifactsOpen(true);
    } catch {
      setToast({ kind: "error", title: "Couldn’t read artifacts", message: "Your browser blocked access to this site’s local recovery data." });
    }
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput(""); setBusy(true);
    setMessages((old) => [...old, { role: "user", text }, { role: "assistant", text: "Understanding your request…" }]);
    try {
      const result = await fetch(`${api}/chat/interpret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: text }) });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error || "Could not interpret that request.");
      const action = data.action as Action | null;
      const answer: Message = { role: "assistant", text: data.reply };
      if (action) {
        const tokenIn = ROBINHOOD_CHAIN_TOKENS.find((t) => t.symbol === action.tokenIn && DEFAULT_TOKENS[t.symbol]);
        const tokenOut = ROBINHOOD_CHAIN_TOKENS.find((t) => t.symbol === action.tokenOut && DEFAULT_TOKENS[t.symbol]);
        if (!tokenIn || !tokenOut) throw new Error("That token isn't currently supported for Curtain swaps.");
        const recipient = action.recipient ?? account;
        if (recipient && !isAddress(recipient)) throw new Error("The recipient address is invalid.");
        const amountIn = parseUnits(action.amount, tokenIn.decimals);
        const routed = await fetch(`${api}/chat/route`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: text, amount: action.amount, tokenIn: tokenIn.address, tokenOut: tokenOut.address, amountIn: amountIn.toString() }) });
        const routeData = await routed.json();
        if (!routed.ok) throw new Error(routeData.error || "Unable to get a swap quote.");
        answer.text = routeData.reply;
        answer.proposal = { action, quote: routeData.quote, route: routeData.route, ...(recipient ? { recipient: recipient as Address } : {}) };
      }
      setMessages((old) => [...old.slice(0, -1), answer]);
    } catch (err) {
      setMessages((old) => [...old.slice(0, -1), { role: "assistant", text: err instanceof Error ? err.message : "Something went wrong." }]);
    } finally { setBusy(false); }
  }

  async function accept(index: number, proposal: Proposal) {
    if (!account) { openConnectModal?.(); return; }
    if (!isConnected) return;
    setMessages((old) => old.map((m, i) => i === index ? { ...m, state: "pending", text: "Preparing your Dynamic Privacy swap. Confirm any wallet requests to continue." } : m));
    try {
      const tokenIn = ROBINHOOD_CHAIN_TOKENS.find((t) => t.symbol === proposal.action.tokenIn)!;
      const tokenOut = ROBINHOOD_CHAIN_TOKENS.find((t) => t.symbol === proposal.action.tokenOut)!;
      const injected = (window as Window & { ethereum?: Parameters<typeof custom>[0] }).ethereum;
      if (!injected) throw new Error("No compatible wallet was detected.");
      const walletClient = createWalletClient({ account, chain, transport: custom(injected) });
      const amountIn = parseUnits(proposal.action.amount, tokenIn.decimals);
      let route = proposal.route.id;
      let quote = proposal.quote;
      const recipient = proposal.recipient ?? account;
      if (!recipient || !isAddress(recipient)) throw new Error("Connect a wallet or provide a valid recipient address.");
      if (route === "v4") {
        const poolRoute = await import("./poolV4");
        try {
          const poolResult = await poolRoute.poolV4Swap({ publicClient, walletClient, tokenIn: tokenIn.address, tokenOut: tokenOut.address, amountIn, minOut: BigInt(quote.minOut ?? quote.minOutSuggested), recipient, onStatus: (status) => setMessages((old) => old.map((m, i) => i === index ? { ...m, state: "pending", text: status } : m)) });
          setMessages((old) => old.map((m, i) => i === index ? { ...m, state: "done", text: poolResult.deliveryConfirmed ? `Private swap complete using Curtain V4. Your output was delivered.` : `Your Curtain V4 private swap was submitted. Delivery confirmation is delayed; don’t submit again. Your recovery note remains saved.` } : m));
          setToast(poolResult.deliveryConfirmed
            ? { kind: "success", title: "Swap complete", message: "Your output was delivered. Your recovery note is saved in this browser." }
            : { kind: "success", title: "Swap submitted", message: "Delivery confirmation is delayed. Don’t submit again; your recovery note is saved in this browser." });
          return;
        } catch (error) {
          if (!(error instanceof poolRoute.PoolV4FallbackError)) throw error;
          const fallback = await fetch(`${api}/chat/route`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: proposal.action.amount, amount: proposal.action.amount, tokenIn: tokenIn.address, tokenOut: tokenOut.address, amountIn: amountIn.toString(), excludeV4: true }) });
          const next = await fallback.json();
          if (!fallback.ok) throw new Error(next.error || "No fallback route is available.");
          route = next.route.id;
          quote = next.quote;
          setMessages((old) => old.map((m, i) => i === index ? { ...m, proposal: { ...proposal, route: next.route, quote }, state: "pending", text: next.reply } : m));
        }
      }
      const version = route === "v3" ? "v3" : "v2";
      const service = await fetch(`${api}/config`, { headers: { "x-curtain-version": version } }).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });
      const client = new CurtainClient({ apiUrl: api, vaultAddress: service.vault as Address, publicClient, walletClient, fetch: (url, init) => fetch(url, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), "x-curtain-version": version } }) });
      const result = await client.swap({ tokenIn: tokenIn.address, amountIn, tokenOut: tokenOut.address, recipient, minOut: BigInt(quote.minOutSuggested), delaySeconds: 0 }, { onIntent: storeTicket });
      const ticket = { ...result.ticket, intentId: result.intentId };
      localStorage.setItem(`curtain-chat-ticket:${result.intentId}`, JSON.stringify({ ...ticket, createdAt: Date.now(), source: "chat" }));
      const routeLabel = route === "v3" ? "Curtain V3 · fixed denominations" : "Curtain V2 · flexible amounts";
      setMessages((old) => old.map((m, i) => i === index ? { ...m, state: "done", text: `Deposit confirmed using ${routeLabel}. Your swap is now in the delivery queue. Escape ticket saved in this browser.` } : m));
      setToast({ kind: "success", title: "Deposit confirmed", message: "Your swap is in the delivery queue. Your escape ticket is saved in this browser." });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Swap was not completed.";
      setMessages((old) => old.map((m, i) => i === index ? { ...m, state: undefined, text: message } : m));
      setToast({ kind: "error", title: "Swap not completed", message });
    }
  }

  return <main className="shell">
    {toast && <div className={`toast toast-${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"} aria-live={toast.kind === "error" ? "assertive" : "polite"}><span className="toast-icon">{toast.kind === "success" ? <CircleCheck size={20}/> : <CircleAlert size={20}/>}</span><span className="toast-copy"><strong>{toast.title}</strong><span>{toast.message}</span></span><button className="toast-dismiss" onClick={() => setToast(null)} aria-label="Dismiss notification"><X size={17}/></button></div>}
    <header><a className="brand" href="https://www.curtainrh.com"><img src="/curtain-logo.png" /><span>Curtain <small>CHAT</small></span></a><div className="header-right"><button className="artifacts-button" onClick={openArtifacts}><Archive size={16}/> Artifacts</button>{isConnected ? <button className="wallet" onClick={() => disconnect()}>{account?.slice(0, 6)}…{account?.slice(-4)}</button> : <button className="wallet" onClick={() => openConnectModal?.()}>Connect wallet</button>}</div></header>
    <section className="intro"><div className="eyebrow">A CONVERSATION WITH CURTAIN</div><h1>Say what you<br/><em>want to swap.</em></h1><p>Review the details. Approve only when you’re ready.</p></section>
    <section className="conversation" aria-live="polite">
      {messages.map((m, i) => <article className={`message ${m.role}`} key={i}><div className="avatar">{m.role === "assistant" ? <img src="/curtain-logo.png"/> : "YOU"}</div><div className="message-content"><div className="message-name">{m.role === "assistant" ? "Curtain" : "You"}</div><p>{m.role === "assistant" ? <AnimatedText text={m.text}/> : m.text}</p>
        {m.proposal && <div className="proposal"><div className="proposal-head"><span>SWAP PROPOSAL</span></div><div className="swap-line"><strong>{m.proposal.action.amount} {m.proposal.action.tokenIn}</strong><span>to</span><strong>{formatUnits(BigInt(m.proposal.quote.expectedOut), ROBINHOOD_CHAIN_TOKENS.find(t=>t.symbol===m.proposal!.action.tokenOut)!.decimals)} {m.proposal.action.tokenOut}</strong></div><div className="proposal-meta"><span>Minimum received</span><b>{formatUnits(BigInt(m.proposal.quote.minOut ?? m.proposal.quote.minOutSuggested), ROBINHOOD_CHAIN_TOKENS.find(t=>t.symbol===m.proposal!.action.tokenOut)!.decimals)} {m.proposal.action.tokenOut}</b><span>Recipient</span><b>{m.proposal.recipient ? `${m.proposal.recipient.slice(0,8)}…${m.proposal.recipient.slice(-6)}` : "Your connected wallet"}</b><span>Quote venue</span><b>{m.proposal.quote.venue}</b></div>{m.proposal.quote.available ? <div className="proposal-actions">{m.state === "pending" ? <button disabled><LoaderCircle className="spin" size={17}/> Waiting for wallet</button> : m.state === "done" ? <button disabled><Check size={17}/> Deposit confirmed</button> : m.state === "denied" ? <span className="muted">Proposal declined</span> : <><button className="accept" onClick={() => accept(i,m.proposal!)}><Check size={17}/> Review & approve</button><button className="deny" onClick={() => setMessages(old=>old.map((x,j)=>j===i?{...x,state:"denied"}:x))}><X size={17}/> Decline</button></>}</div> : <div className="unavailable">No route is available for this pair right now.</div>}</div>}
      </div></article>)}
      {busy && <div className="working"><LoaderCircle className="spin" size={16}/> Preparing your response…</div>}
    </section>
    <form className="composer" onSubmit={send}><textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send();}}} placeholder="Try: Swap 10 USDG to NVDA" rows={2} maxLength={4000}/><button type="submit" disabled={busy||!input.trim()} aria-label="Send"><ArrowUp size={20}/></button><div className="composer-note">Your wallet signs transactions. Curtain Chat cannot move funds on its own.</div></form>
    <footer>Robinhood Chain <span>·</span> <a href="https://docs.curtainrh.com">How Curtain works</a></footer>
    {artifactsOpen && <div className="artifacts-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setArtifactsOpen(false); }}><section className="artifacts-panel" role="dialog" aria-modal="true" aria-labelledby="artifacts-title"><div className="artifacts-heading"><div><div className="eyebrow">SAVED ON THIS DEVICE</div><h2 id="artifacts-title">Artifacts</h2></div><button className="artifacts-close" onClick={() => setArtifactsOpen(false)} aria-label="Close artifacts"><X size={20}/></button></div><p className="artifacts-warning">These files contain recovery credentials. Keep downloads private and never share them; anyone with an escape ticket or recovery secret may be able to act on it.</p>{artifacts.length === 0 ? <div className="artifacts-empty">No saved tickets or recovery notes found in this browser.</div> : <div className="artifact-list">{artifacts.map((artifact) => <article className="artifact-card" key={`${artifact.kind}:${artifact.id}`}><div className="artifact-card-head"><div><strong>{artifact.kind}</strong><span>{artifactDate(artifact.createdAt)}</span></div><button className="artifact-download" onClick={() => downloadArtifact(artifact)}><Download size={15}/> Download</button></div><div className="artifact-id">{artifact.kind === "Escape ticket" ? "Intent" : "Commitment"} <code>{artifact.id}</code></div>{artifact.kind === "Pool V4 recovery note" && typeof artifact.data.secret === "string" && <details className="artifact-secret"><summary>Show recovery secret</summary><code>{artifact.data.secret}</code></details>}<details className="artifact-details"><summary>View artifact data</summary><pre>{JSON.stringify(artifact.data, null, 2)}</pre></details></article>)}</div>}</section></div>}
  </main>;
}
