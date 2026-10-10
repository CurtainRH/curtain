import { useState, type FormEvent } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ArrowUp, Check, LoaderCircle, Shield, X } from "lucide-react";
import { createPublicClient, createWalletClient, custom, formatUnits, http, isAddress, parseUnits, type Address } from "viem";
import { CurtainClient, DEFAULT_TOKENS, ROBINHOOD_CHAIN_TOKENS, type PendingTicket } from "@curtain/sdk";
import { chain } from "./wagmi";

type Action = { type: "swap"; amount: string; tokenIn: string; tokenOut: string; recipient?: string };
type Proposal = { action: Action; quote: { expectedOut: string; minOutSuggested: string; available: boolean; venue: string }; recipient?: Address };
type Message = { role: "user" | "assistant"; text: string; route?: string; proposal?: Proposal; state?: "pending" | "done" | "denied" };
const api = "/api/curtain";
const publicClient = createPublicClient({ chain, transport: http("/api/rpc", { retryCount: 2, timeout: 12_000 }) });
const storeTicket = (ticket: PendingTicket) => {
  const key = `curtain-chat-ticket:${ticket.intentId}`;
  localStorage.setItem(key, JSON.stringify({ ...ticket, createdAt: Date.now(), source: "chat" }));
};

export default function App() {
  const { address: account, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", text: "Tell me what you’d like to swap. I’ll prepare a proposal for you to review; nothing is sent until you approve it in your wallet.", route: "Curtain V2 · flexible-amount route" }]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput(""); setBusy(true);
    setMessages((old) => [...old, { role: "user", text }, { role: "assistant", text: "Understanding your request…", route: "Curtain V2 · flexible-amount route" }]);
    try {
      const result = await fetch(`${api}/chat/interpret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: text }) });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error || "Could not interpret that request.");
      const action = data.action as Action | null;
      const answer: Message = { role: "assistant", text: data.reply, route: data.routeDisclosure };
      if (action) {
        const tokenIn = ROBINHOOD_CHAIN_TOKENS.find((t) => t.symbol === action.tokenIn && DEFAULT_TOKENS[t.symbol]);
        const tokenOut = ROBINHOOD_CHAIN_TOKENS.find((t) => t.symbol === action.tokenOut && DEFAULT_TOKENS[t.symbol]);
        if (!tokenIn || !tokenOut) throw new Error("That token is not available for Curtain V2 swaps.");
        const recipient = action.recipient ?? account;
        if (recipient && !isAddress(recipient)) throw new Error("The recipient address is invalid.");
        const amountIn = parseUnits(action.amount, tokenIn.decimals);
        const q = await fetch(`${api}/quote?tokenIn=${tokenIn.address}&tokenOut=${tokenOut.address}&amountIn=${amountIn}&slippageBps=100`, { headers: { "x-curtain-version": "v2" } });
        const quote = await q.json();
        if (!q.ok) throw new Error(quote.error || "Unable to get a swap quote.");
        answer.proposal = { action, quote, ...(recipient ? { recipient: recipient as Address } : {}) };
      }
      setMessages((old) => [...old.slice(0, -1), answer]);
    } catch (err) {
      setMessages((old) => [...old.slice(0, -1), { role: "assistant", text: err instanceof Error ? err.message : "Something went wrong.", route: "Curtain V2 · flexible-amount route" }]);
    } finally { setBusy(false); }
  }

  async function accept(index: number, proposal: Proposal) {
    if (!account) { openConnectModal?.(); return; }
    if (!isConnected) return;
    setMessages((old) => old.map((m, i) => i === index ? { ...m, state: "pending", text: "Preparing your Curtain V2 swap. Confirm any approval and deposit requests in your wallet." } : m));
    try {
      const tokenIn = ROBINHOOD_CHAIN_TOKENS.find((t) => t.symbol === proposal.action.tokenIn)!;
      const tokenOut = ROBINHOOD_CHAIN_TOKENS.find((t) => t.symbol === proposal.action.tokenOut)!;
      const injected = (window as Window & { ethereum?: Parameters<typeof custom>[0] }).ethereum;
      if (!injected) throw new Error("No compatible wallet was detected.");
      const walletClient = createWalletClient({ account, chain, transport: custom(injected) });
      const service = await fetch(`${api}/config`, { headers: { "x-curtain-version": "v2" } }).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });
      const client = new CurtainClient({ apiUrl: api, vaultAddress: service.vault as Address, publicClient, walletClient, fetch: (url, init) => fetch(url, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), "x-curtain-version": "v2" } }) });
      const amountIn = parseUnits(proposal.action.amount, tokenIn.decimals);
      const recipient = proposal.recipient ?? account;
      if (!recipient || !isAddress(recipient)) throw new Error("Connect a wallet or provide a valid recipient address.");
      const result = await client.swap({ tokenIn: tokenIn.address, amountIn, tokenOut: tokenOut.address, recipient, minOut: BigInt(proposal.quote.minOutSuggested), delaySeconds: 0 }, { onIntent: storeTicket });
      const ticket = { ...result.ticket, intentId: result.intentId };
      localStorage.setItem(`curtain-chat-ticket:${result.intentId}`, JSON.stringify({ ...ticket, createdAt: Date.now(), source: "chat" }));
      setMessages((old) => old.map((m, i) => i === index ? { ...m, state: "done", text: `Deposit confirmed. Your Curtain V2 swap is now in the delivery queue. Escape ticket saved in this browser.`, route: `Curtain V2 · ${result.intentId}` } : m));
    } catch (err) {
      setMessages((old) => old.map((m, i) => i === index ? { ...m, state: undefined, text: err instanceof Error ? err.message : "Swap was not completed." } : m));
    }
  }

  return <main className="shell">
    <header><a className="brand" href="https://www.curtainrh.com"><img src="/curtain-logo.png" /><span>Curtain <small>CHAT</small></span></a><div className="header-right"><span className="route-tag"><Shield size={15}/> Curtain V2</span>{isConnected ? <button className="wallet" onClick={() => disconnect()}>{account?.slice(0, 6)}…{account?.slice(-4)}</button> : <button className="wallet" onClick={() => openConnectModal?.()}>Connect wallet</button>}</div></header>
    <section className="intro"><div className="eyebrow">A CONVERSATION WITH CURTAIN</div><h1>Say what you<br/><em>want to swap.</em></h1><p>Review the details. Approve only when you’re ready.</p></section>
    <section className="conversation" aria-live="polite">
      {messages.map((m, i) => <article className={`message ${m.role}`} key={i}><div className="avatar">{m.role === "assistant" ? <img src="/curtain-logo.png"/> : "YOU"}</div><div className="message-content"><div className="message-name">{m.role === "assistant" ? "Curtain" : "You"}</div><p>{m.text}</p>{m.route && <div className="route-disclosure"><Shield size={14}/>{m.route}</div>}
        {m.proposal && <div className="proposal"><div className="proposal-head"><span>SWAP PROPOSAL</span><span className="route-pill">CURTAIN V2</span></div><div className="swap-line"><strong>{m.proposal.action.amount} {m.proposal.action.tokenIn}</strong><span>to</span><strong>{formatUnits(BigInt(m.proposal.quote.expectedOut), ROBINHOOD_CHAIN_TOKENS.find(t=>t.symbol===m.proposal!.action.tokenOut)!.decimals)} {m.proposal.action.tokenOut}</strong></div><div className="proposal-meta"><span>Minimum received</span><b>{formatUnits(BigInt(m.proposal.quote.minOutSuggested), ROBINHOOD_CHAIN_TOKENS.find(t=>t.symbol===m.proposal!.action.tokenOut)!.decimals)} {m.proposal.action.tokenOut}</b><span>Recipient</span><b>{m.proposal.recipient ? `${m.proposal.recipient.slice(0,8)}…${m.proposal.recipient.slice(-6)}` : "Your connected wallet"}</b><span>Route</span><b>Curtain V2 · flexible amounts</b><span>Quote venue</span><b>{m.proposal.quote.venue}</b></div>{m.proposal.quote.available ? <div className="proposal-actions">{m.state === "pending" ? <button disabled><LoaderCircle className="spin" size={17}/> Waiting for wallet</button> : m.state === "done" ? <button disabled><Check size={17}/> Deposit confirmed</button> : m.state === "denied" ? <span className="muted">Proposal declined</span> : <><button className="accept" onClick={() => accept(i,m.proposal!)}><Check size={17}/> Review & approve</button><button className="deny" onClick={() => setMessages(old=>old.map((x,j)=>j===i?{...x,state:"denied"}:x))}><X size={17}/> Decline</button></>}</div> : <div className="unavailable">No route is available for this pair right now.</div>}</div>}
      </div></article>)}
      {busy && <div className="working"><LoaderCircle className="spin" size={16}/> Preparing your response…</div>}
    </section>
    <form className="composer" onSubmit={send}><textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send();}}} placeholder="Try: Swap 10 USDG to NVDA" rows={2} maxLength={4000}/><button type="submit" disabled={busy||!input.trim()} aria-label="Send"><ArrowUp size={20}/></button><div className="composer-note">Your wallet signs transactions. Curtain Chat cannot move funds on its own.</div></form>
    <footer>Robinhood Chain <span>·</span> <a href="https://docs.curtainrh.com">How Curtain works</a></footer>
  </main>;
}
