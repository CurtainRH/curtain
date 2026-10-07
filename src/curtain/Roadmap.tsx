import { ArrowUpRight, CheckCircle2, Clock, Sparkles, Layers, ShieldCheck, Milestone } from "lucide-react";
import { RouteLink } from "./App";

interface MilestoneItem {
  act: string;
  title: string;
  period: string;
  status: "completed" | "in-progress" | "upcoming";
  summary: string;
  deliverables: string[];
}

const milestones: MilestoneItem[] = [
  {
    act: "Act I",
    title: "The Overture: Core Protocol & Vault Architecture",
    period: "Q3 – Q4 2026",
    status: "completed",
    summary:
      "Foundational deployment of non-custodial privacy infrastructure on Robinhood Chain (ID: 4663).",
    deliverables: [
      "CurtainVault smart contract deployed and verified on Robinhood Chain",
      "Opaque commitment deposits with client-side salt generation",
      "Optimistic refund escape hatch (requestRefund / finalizeRefund)",
      "Automated Escape Ticket JSON client downloads on swap deposit",
      "Support for tokenized bluechips: USDG, NVDA, TSLA, SPY, QQQ, HOOD",
      "Comprehensive smart contract security audit and formal verification",
      "Retractable navigation interface and responsive luxury aesthetic",
    ],
  },
  {
    act: "Act II",
    title: "The Anonymity Chorus: Deep Liquidity & Stealth Inboxes",
    period: "Q1 2027",
    status: "in-progress",
    summary:
      "Expansion of privacy vectors through advanced anonymity sets, split timing, and ERC-5564 stealth mechanics.",
    deliverables: [
      "Dynamic Anonymity Sets: real-time pool metrics & delayed batch mixing",
      "Split Timing: automated division of large swaps into 2–5 random-window sub-swaps",
      "Split Payouts: randomized share distribution across multiple destination wallets",
      "ERC-5564 Stealth Address receiver inbox with client-side view-tag matching",
      "Permissionless Keeper network with decentralized settle() execution incentives",
      "Automated MEV and sandwich protection via private RPC relay bundles",
    ],
  },
  {
    act: "Act III",
    title: "The Sovereign Stage: $CRTN Token & Protocol Staking",
    period: "Q2 2027",
    status: "upcoming",
    summary:
      "Decentralization of protocol governance, community fee distribution, and token generation.",
    deliverables: [
      "Curtain Token ($CRTN) Generation Event on Robinhood Chain",
      "CurtainStaking contract activation with 30d (1×), 90d (1.5×), and 180d (2×) lock tiers",
      "100% of protocol swap fees (0.20%) routed to active $CRTN stakers",
      "Operator hot-key migration to a distributed Multi-Party Computation (MPC) cluster",
      "Two-step multisig ownership transfer for protocol parameter governance",
      "Community asset allowlisting via token-weighted governance votes",
    ],
  },
  {
    act: "Act IV",
    title: "The Private Reserve: Shielded Lending & Credit",
    period: "Q3 2027",
    status: "upcoming",
    summary:
      "Non-custodial collateralized borrowing and lending with complete position privacy.",
    deliverables: [
      "Integration with Morpho Vaults on Robinhood Chain",
      "Shielded collateral positions: borrow USDG against tokenized equities (NVDA, TSLA)",
      "Zero-exposure liquidation thresholds: private health factor monitoring",
      "Isolated credit markets for accredited and institutional participants",
      "Curtain Yield Router: automated yield optimization across private vaults",
    ],
  },
  {
    act: "Act V",
    title: "The Grand Finale: Zero-Knowledge Proofs & Dark Pools",
    period: "Q4 2027+",
    status: "upcoming",
    summary:
      "Next-generation ZK-SNARK batch verification and cross-chain dark pool liquidity.",
    deliverables: [
      "Recursive ZK-SNARK proof aggregation for zero-footprint on-chain settlements",
      "Cross-chain private liquidity bridges connecting Robinhood Chain, Ethereum, and Arbitrum",
      "Institutional Dark Pool API with cryptographic compliance attestations",
      "Autonomous decentralized validator network replacing operator relayers",
    ],
  },
];

export default function Roadmap() {
  return (
    <main id="main" className="section legal">
      <div className="legal-header">
        <p className="eyebrow">CURTAIN PROTOCOL / STRATEGIC ROADMAP</p>
        <h1 tabIndex={-1}>The Acts of Curtain</h1>
        <p>
          From non-custodial swaps on Robinhood Chain to institutional dark pools and sovereign
          shielded credit. Explore the five acts of our deliberate protocol progression.
        </p>
        <div style={{ display: "flex", gap: "16px", marginTop: "24px", flexWrap: "wrap" }}>
          <span className="chain-tag">TARGET TIMELINE: 2026 – 2027+</span>
          <span className="chain-tag">PHASE: ACT I LIVE · ACT II IN FLIGHT</span>
          <RouteLink
            to="/whitepaper"
            className="underlined-link"
            style={{ padding: "0 4px", fontSize: "0.75rem" }}
          >
            Read the Whitepaper <ArrowUpRight size={12} />
          </RouteLink>
        </div>
      </div>

      <div className="legal-layout">
        <nav className="legal-nav" aria-label="Roadmap navigation">
          {milestones.map((m, idx) => (
            <a key={m.act} href={`#act-${idx + 1}`}>
              {m.act}: {m.title.split(":")[0]}
            </a>
          ))}
          <RouteLink to="/whitepaper">
            Read whitepaper <ArrowUpRight size={12} />
          </RouteLink>
          <RouteLink to="/app">
            Launch private box <ArrowUpRight size={12} />
          </RouteLink>
        </nav>

        <article className="legal-copy">
          <p className="legal-date">LAST UPDATED · OCTOBER 2026 · CURTAIN CORE TEAM</p>

          {milestones.map((m, idx) => (
            <section key={m.act} id={`act-${idx + 1}`} style={{ position: "relative" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", marginBottom: "8px" }}>
                <span className="eyebrow" style={{ fontSize: "0.7rem", color: "var(--gold)" }}>
                  {m.act.toUpperCase()} · {m.period}
                </span>
                <span
                  style={{
                    fontSize: "0.65rem",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    padding: "4px 8px",
                    borderRadius: "2px",
                    border: `1px solid ${
                      m.status === "completed"
                        ? "#5cd68540"
                        : m.status === "in-progress"
                          ? "#d2ae6f50"
                          : "var(--line)"
                    }`,
                    background:
                      m.status === "completed"
                        ? "#15332080"
                        : m.status === "in-progress"
                          ? "#2e231180"
                          : "#101d2d50",
                    color:
                      m.status === "completed"
                        ? "#73e298"
                        : m.status === "in-progress"
                          ? "var(--gold)"
                          : "var(--muted)",
                  }}
                >
                  {m.status === "completed"
                    ? "✓ Completed & Live"
                    : m.status === "in-progress"
                      ? "⚡ In Active Development"
                      : "○ Scheduled"}
                </span>
              </div>

              <h2>{m.title}</h2>
              <p>{m.summary}</p>

              <div
                style={{
                  background: "#081323",
                  border: "1px solid var(--line)",
                  padding: "20px 24px",
                  borderRadius: "2px",
                  marginTop: "20px",
                }}
              >
                <p style={{ margin: "0 0 14px", color: "var(--bright)", fontSize: "0.82rem", fontWeight: 500, letterSpacing: "0.05em" }}>
                  KEY MILESTONES & DELIVERABLES:
                </p>
                <ul style={{ margin: 0, paddingLeft: "18px" }}>
                  {m.deliverables.map((item, dIdx) => (
                    <li key={dIdx} style={{ marginBottom: "10px", color: "#c1ccdc" }}>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ))}
        </article>
      </div>
    </main>
  );
}
