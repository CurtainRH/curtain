import { ArrowUpRight } from "lucide-react";
import { RouteLink } from "./App";

interface MilestoneItem {
  track: "Backstage" | "Limelight";
  title: string;
  focus: string;
  summary: string;
  deliverables: string[];
}

const milestones: MilestoneItem[] = [
  {
    track: "Backstage",
    title: "Pool v2 · Shielded Pool Foundation",
    focus: "Privacy foundation",
    summary: "A shared shielded balance for supported USDG and stock assets, designed around private transfers and dependable exits.",
    deliverables: [
      "Shield, unshield, and move supported assets privately",
      "Amount-bound notes with solvency proofs",
      "Proof-of-innocence screening",
      "Permanent refund and exit paths",
      "A guided migration from Curtain’s current swap system",
    ],
  },
  {
    track: "Backstage",
    title: "Understudy · Purpose-built private accounts",
    focus: "Private account control",
    summary: "Optional, task-specific accounts for taking actions without exposing a user’s main wallet as the public position holder.",
    deliverables: [
      "One-time accounts with user-controlled recovery",
      "Clear limits on approved venues, actions, assets, and amounts",
      "Gas paid from Curtain balances where supported",
      "Public positions separated from the user’s main wallet",
    ],
  },
  {
    track: "Backstage",
    title: "Backstage · Private trading",
    focus: "Trading behind the curtain",
    summary: "Buy and sell selected tokens from shielded balances, with assets returning to the pool after a trade.",
    deliverables: [
      "Private routes for selected stock and launch assets",
      "Initial venue integrations and approved trading pairs",
      "Asset checks for transfer behavior, liquidity, age, and size limits",
    ],
  },
  {
    track: "Backstage",
    title: "Honest Launch · Safer token launches",
    focus: "Launch transparency",
    summary: "Launch tools that preserve private participation while making supply limits and launch rules verifiable.",
    deliverables: [
      "Shielded-supply caps, with tighter limits during launch windows",
      "Screening for deployers and launch funding sources",
      "Public aggregate participation indicators",
      "On-chain launch certificates and readable launch data",
    ],
  },
  {
    track: "Backstage",
    title: "Passes · Private prepaid usage",
    focus: "Flexible payments",
    summary: "Prepaid units for supported services, purchased and redeemed from shielded balances.",
    deliverables: [
      "Fixed-denomination passes for gas, AI, agent payments, and relays",
      "Blind-signed issuance to reduce purchase-to-use linkage",
      "Double-spend protection and redemption back into shielded balances",
    ],
  },
  {
    track: "Backstage",
    title: "Green Room · Private AI sessions",
    focus: "Private compute groundwork",
    summary: "A privacy-first inference experience built around encrypted inputs and outputs, with hardware-attestation checks before use.",
    deliverables: [
      "Client-side verification of supported confidential-compute hardware",
      "Encrypted prompts, model materials, datasets, and outputs in transit",
      "Restricted, measured model images and isolated sessions",
      "History kept locally by default, with optional encrypted sync",
    ],
  },
  {
    track: "Backstage",
    title: "Stage Door · Private agents",
    focus: "Agent payments and permissions",
    summary: "Give agents limited, auditable capabilities without handing them broad control of a wallet.",
    deliverables: [
      "Pass-backed payments for supported agent services",
      "Session keys with budgets, purpose limits, and expiration",
      "MCP tools for quotes, payments, accounts, and private actions",
    ],
  },
  {
    track: "Backstage",
    title: "Private Borrowing · Stock-backed credit",
    focus: "Private credit",
    summary: "Explore borrowing USDG against selected tokenized stocks through isolated markets, with clear liquidation and oracle safeguards.",
    deliverables: [
      "Selected collateral and isolated lending markets",
      "Oracle handling for stock-token multiplier metadata",
      "Staleness, market-hours, liquidity, and liquidation protections",
    ],
  },
  {
    track: "Backstage",
    title: "Wings · Private perpetuals",
    focus: "Advanced trading",
    summary: "A later-stage design for opening and closing derivatives positions from shielded balances, with explicit fallback behavior.",
    deliverables: [
      "Private position notes and batched position actions",
      "Exposure controls and verifiable liquidation rules",
      "Independent fallback monitoring and a solo-close path",
    ],
  },
  {
    track: "Backstage",
    title: "Entrance · Shielded cross-chain access",
    focus: "Cross-chain entry and exit",
    summary: "Explore shielded transfers between supported chains with escrow, replay protection, and user exits built in.",
    deliverables: [
      "Initial source-chain and destination-chain support",
      "Bonded fillers and exact-output escrow",
      "Source-side screening, refunds, and replay protection",
    ],
  },
  {
    track: "Backstage",
    title: "Opening Night · Sealed-bid launches",
    focus: "Private market launches",
    summary: "A launch format where bids are private until a common clearing price is determined.",
    deliverables: [
      "Sealed bids with hidden amounts and price limits",
      "One clearing price and public allocations after clearing",
      "Published developer allocation, vesting, and liquidity rules",
    ],
  },
  {
    track: "Backstage",
    title: "Playbill · Selective proof of funds",
    focus: "User-controlled disclosure",
    summary: "Tools for proving specific financial claims without publishing a complete transaction history.",
    deliverables: [
      "Delayed trade disclosures and selective view-key exports",
      "Threshold proofs that reveal only the requested claim",
      "Public verification of user-authorized disclosures",
    ],
  },
  {
    track: "Limelight",
    title: "Booths · Attested GPU sessions",
    focus: "Private compute",
    summary: "Confidential GPU sessions for inference and selected training workloads, subject to hardware, model, and safety verification.",
    deliverables: [
      "Attested Intel TDX and NVIDIA confidential-compute hosts",
      "Serve, batch inference, and text-model fine-tuning modes",
      "Encrypted inputs, weights, datasets, and outputs",
      "Measured images, restricted network access, and signed usage records",
    ],
  },
  {
    track: "Limelight",
    title: "Lamps · Compute capacity market",
    focus: "GPU-hour contracts",
    summary: "A marketplace for reserving a defined GPU class and delivery period, backed by service commitments and escrow.",
    deliverables: [
      "Prepaid GPU-hour units by GPU class and delivery month",
      "Primary sales and secondary trading",
      "Seller reservations, delivery acceptance, and completion records",
      "Escrow-backed refunds when service terms are not met",
    ],
  },
  {
    track: "Limelight",
    title: "Rig Rate · Compute pricing and host network",
    focus: "Market quality and supply",
    summary: "Build reliable price references and a host network before expanding the compute marketplace.",
    deliverables: [
      "Public hourly price history by GPU class",
      "Source-quality labels and thin-market warnings",
      "Attested host registration, performance checks, and bonds",
      "Defined dispute and slashing rules before host payouts",
    ],
  },
  {
    track: "Limelight",
    title: "AI Rig Shelf · Compute infrastructure assets",
    focus: "RWA access",
    summary: "Evaluate carefully scoped exposure to canonical AI-infrastructure assets, with liquidity limits and clear redemption terms.",
    deliverables: [
      "Asset-by-asset eligibility and issuer review",
      "Liquidity and position-size limits",
      "Defined baskets and in-kind redemption where supported",
    ],
  },
  {
    track: "Limelight",
    title: "Reserve Shelf · Cash and commodity exposure",
    focus: "RWA access",
    summary: "Explore supported Treasury-bill and gold-linked assets with public disclosures and optional private access paths.",
    deliverables: [
      "Review of issuer, custody, eligibility, and redemption terms",
      "Public and private buy/sell paths where the asset supports them",
      "Clear disclosures for backing, restrictions, and market hours",
    ],
  },
  {
    track: "Limelight",
    title: "Private Credit · Outside positions",
    focus: "Credit and connected venues",
    summary: "Investigate private access to selected credit and external trading venues without implying that the venue itself cannot see activity.",
    deliverables: [
      "Disclose observed rates, backing, and counterparty dependencies",
      "Represent supported external positions with clear venue visibility",
      "Document liquidation and exit behavior before enabling access",
    ],
  },
  {
    track: "Limelight",
    title: "Compute Markets · Later-stage GPU futures",
    focus: "Advanced compute markets",
    summary: "Consider GPU-hour markets on Wings only after compute pricing and delivery have enough depth to support them responsibly.",
    deliverables: [
      "Launch only after Rig Rate history and Lamps volume meet published thresholds",
      "Close-only fallback when market depth or index quality is insufficient",
      "Transparent settlement, margin, and delivery-risk rules",
    ],
  },
];

const tracks = ["Backstage", "Limelight"] as const;

export default function Roadmap() {
  return (
    <main id="main" className="section legal">
      <div className="legal-header">
        <p className="eyebrow">CURTAIN / PRODUCT ROADMAP</p>
        <h1 tabIndex={-1}>From Backstage to Limelight</h1>
        <p>
          Curtain is building from private financial tools toward private compute and carefully
          selected real-world-asset access. The sequence below is a direction, not a launch promise.
        </p>
        <div style={{ display: "flex", gap: "16px", marginTop: "24px", flexWrap: "wrap" }}>
          <span className="chain-tag">BACKSTAGE · PRIVATE FINANCIAL FOUNDATION</span>
          <span className="chain-tag">LIMELIGHT · PRIVATE COMPUTE & RWA EXPANSION</span>
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
          {tracks.map((track) => (
            <a key={track} href={`#track-${track.toLowerCase()}`}>{track}</a>
          ))}
          <RouteLink to="/whitepaper">
            Read whitepaper <ArrowUpRight size={12} />
          </RouteLink>
          <RouteLink to="/app">
            Launch Curtain <ArrowUpRight size={12} />
          </RouteLink>
        </nav>

        <article className="legal-copy">
          <p className="legal-date">PLANNING STATUS · OCTOBER 2026 · SUBJECT TO CHANGE</p>
          <p>
            Curtain’s current V2/V3 vaults, operator, keeper, API, MCP, dashboard, and Swap remain
            the production system. The expansion items below are planned capabilities—not claims
            that they are already live. Backstage is the foundation; Limelight follows once the
            privacy, delivery, and market safeguards are ready.
          </p>

          {tracks.map((track) => {
            const items = milestones.filter((milestone) => milestone.track === track);
            return (
              <section key={track} id={`track-${track.toLowerCase()}`}>
                <h2>{track}</h2>
                <p>
                  {track === "Backstage"
                    ? "The private financial foundation: shielded assets, controlled actions, and dependable exits."
                    : "The next expansion: confidential compute services and selected real-world-asset markets, introduced in stages."}
                </p>
                {items.map((milestone, index) => (
                  <section key={milestone.title} style={{ position: "relative", marginTop: "30px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", marginBottom: "8px" }}>
                      <span className="eyebrow" style={{ fontSize: "0.7rem", color: "var(--gold)" }}>
                        {track.toUpperCase()} · {String(index + 1).padStart(2, "0")} · {milestone.focus.toUpperCase()}
                      </span>
                      <span style={{ fontSize: "0.65rem", letterSpacing: "0.08em", textTransform: "uppercase", padding: "4px 8px", border: "1px solid var(--line)", background: "#18181850", color: "var(--muted)" }}>
                        Planned · not live
                      </span>
                    </div>
                    <h3>{milestone.title}</h3>
                    <p>{milestone.summary}</p>
                    <div style={{ background: "#111111", border: "1px solid var(--line)", padding: "20px 24px", borderRadius: "2px", marginTop: "20px" }}>
                      <p style={{ margin: "0 0 14px", color: "var(--bright)", fontSize: "0.82rem", fontWeight: 500, letterSpacing: "0.05em" }}>
                        DIRECTIONAL SCOPE
                      </p>
                      <ul style={{ margin: 0, paddingLeft: "18px" }}>
                        {milestone.deliverables.map((item) => (
                          <li key={item} style={{ marginBottom: "10px", color: "#cccccc" }}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </section>
                ))}
              </section>
            );
          })}
        </article>
      </div>
    </main>
  );
}
