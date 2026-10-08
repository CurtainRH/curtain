import { ArrowUpRight, BookOpen, ChevronRight, Download, FileCode, Lock, Shield, Terminal } from "lucide-react";
import { RouteLink } from "./App";

export default function Whitepaper() {
  return (
    <main id="main" className="section legal">
      <div className="legal-header">
        <p className="eyebrow">CURTAIN PROTOCOL / TECHNICAL SPECIFICATION</p>
        <h1 tabIndex={-1}>Curtain Whitepaper</h1>
        <p>
          Non-custodial dark pools, unlinked atomic settlements, and cryptographic escape hatches
          for tokenized real-world assets and crypto bluechips on Robinhood Chain.
        </p>
        <div style={{ display: "flex", gap: "16px", marginTop: "24px", flexWrap: "wrap" }}>
          <span className="chain-tag">VERSION 2.1 — OCTOBER 2026</span>
          <span className="chain-tag">ROBINHOOD CHAIN (ID: 4663)</span>
          <RouteLink
            to="/roadmap"
            className="underlined-link"
            style={{ padding: "0 4px", fontSize: "0.75rem" }}
          >
            Explore the Roadmap <ChevronRight size={12} />
          </RouteLink>
        </div>
      </div>

      <div className="legal-layout">
        <nav className="legal-nav" aria-label="Whitepaper table of contents">
          <a href="#abstract">01. Abstract</a>
          <a href="#problem">02. Problem & Thesis</a>
          <a href="#vault">03. The Vault & Intents</a>
          <a href="#settlement">04. Unlinked Settlements</a>
          <a href="#escape-hatch">05. The Escape Hatch</a>
          <a href="#stealth">06. Stealth Addresses</a>
          <a href="#staking">07. Staking & Tokenomics</a>
          <a href="#threat-model">08. Security & Audits</a>
          <RouteLink to="/roadmap">
            Protocol roadmap <ArrowUpRight size={12} />
          </RouteLink>
          <RouteLink to="/app">
            Launch private box <ArrowUpRight size={12} />
          </RouteLink>
        </nav>

        <article className="legal-copy">
          <p className="legal-date">PUBLISHED · 1 OCTOBER 2026 · CURTAIN CORE CONTRIBUTORS</p>

          <section id="abstract">
            <h2>01. Abstract</h2>
            <p>
              Public distributed ledgers offer unprecedented verifiability at the cost of commercial
              privacy. In decentralized finance, pseudonymous transparency exposes traders to
              toxic maximal extractable value (MEV), copy-trading bots, wallet profiling, and
              front-running. For institutional participants and private capital dealing in
              tokenized equities (e.g. NVDA, TSLA, SPY, HOOD) and digital assets (USDG, ETH), this
              transparency is a structural liability.
            </p>
            <p>
              <strong>Curtain</strong> is a non-custodial privacy layer built specifically for the
              Robinhood Chain ecosystem. By combining client-side cryptographic commitments,
              opaque on-chain deposits, batch settlement aggregation, and optimistic challenge
              escape hatches, Curtain severs the on-chain link between depositors and recipients
              without introducing custodial counterparty risk.
            </p>
          </section>

          <section id="problem">
            <h2>02. Problem & Thesis</h2>
            <p>
              Traditional zero-knowledge mixers introduce prohibitive computational overhead, high
              gas costs, and complex cryptographic setup ceremonies that complicate real-time
              swapping across automated market makers (AMMs). Conversely, centralized relayers
              frequently demand custodial possession of user funds, creating single points of failure
              and regulatory vulnerability.
            </p>
            <p>
              Curtain takes a pragmatically verifiable approach:
            </p>
            <ul>
              <li>
                <strong>Client-Side Secrecy:</strong> Intent parameters (recipient, desired token,
                exact delivery timing, and refund salts) are created locally in the user browser and
                never published on-chain prior to settlement.
              </li>
              <li>
                <strong>Atomic Batch Execution:</strong> Trades are aggregated and executed
                through decentralized liquidity routers, distributing output tokens to recipients
                in the identical block transaction to eliminate front-running.
              </li>
              <li>
                <strong>Mathematical Guarantees:</strong> Users never relinquish custody. If the
                operator node or relayer suffers catastrophic downtime, funds are programmatically
                recoverable via on-chain smart contract methods.
              </li>
            </ul>
          </section>

          <section id="vault">
            <h2>03. The Vault & Intent Generation</h2>
            <p>
              The heart of the Curtain protocol is the <code>CurtainVault</code> contract. The life
              cycle of a private transaction begins with client intent generation:
            </p>
            <div className="status-card" style={{ background: "#0a1626", border: "1px solid var(--line)", padding: "20px", margin: "20px 0" }}>
              <p style={{ margin: "0 0 10px", color: "var(--gold)", fontWeight: 500 }}>Intent Generation Flow:</p>
              <p style={{ margin: "5px 0", fontSize: "0.82rem", fontFamily: "monospace" }}>
                1. User selects: TokenIn (X), Amount, TokenOut (Y), Recipient, and Delay Window.<br />
                2. Client generates 32-byte cryptographically secure salt: <code>salt = crypto.getRandomValues(32)</code>.<br />
                3. Calculated deadline: <code>deadline = executionTime + 600s</code>.<br />
                4. Opaque commitment: <code>deadlineHash = keccak256(abi.encode(deadline, salt))</code>.
              </p>
            </div>
            <p>
              The user broadcasts a simple on-chain deposit transaction:
            </p>
            <pre style={{ background: "#060f1b", border: "1px solid var(--line)", padding: "16px", borderRadius: "4px", overflowX: "auto", fontSize: "0.8rem", color: "#e3caa5" }}>
              <code>{`// Contract interface
function deposit(
    address token,
    uint256 amount,
    bytes32 deadlineHash
) external returns (uint256 depositId);`}</code>
            </pre>
            <p>
              <strong>What the blockchain sees:</strong> Depositor address, input token, and an
              opaque 32-byte hash. The output token, intended destination, and execution delay are
              invisible to on-chain observers.
            </p>
          </section>

          <section id="settlement">
            <h2>04. Unlinked Settlements & Payout Tags</h2>
            <p>
              When a batch of deposits matures, the off-chain operator engine groups pending
              orders by asset pair <code>(X, Y)</code>. The operator constructs an EIP-712 typed
              settlement payload and signs it with its designated hot key.
            </p>
            <p>
              To sever the link between a deposit index and its recipient, each payout includes an
              isolated cryptographic payout tag:
            </p>
            <p style={{ fontFamily: "monospace", color: "var(--gold)", fontSize: "0.85rem", background: "#0b1728", padding: "12px", border: "1px solid var(--line)" }}>
              payoutTag = keccak256(abi.encode(depositId, secret))
            </p>
            <p>
              A permissionless keeper submits the signed settlement bundle directly to
              <code>CurtainVault.settle()</code>. In a single atomic transaction:
            </p>
            <ul>
              <li>The input tokens are pulled from the vault and swapped on an allowlisted DEX router.</li>
              <li>The minimum return output is verified against slippage tolerance (max 0.5%).</li>
              <li>Output tokens are transferred to each recipient.</li>
              <li>Protocol fees (0.20%) and keeper fees (0.05%) are disbursed.</li>
              <li>The vault marks the settlement tag as fulfilled.</li>
            </ul>
          </section>

          <section id="escape-hatch">
            <h2>05. The Optimistic Escape Hatch</h2>
            <p>
              In conventional bridge and relayer systems, operator failure causes permanent asset
              loss. Curtain removes this vulnerability through an on-chain optimistic refund
              mechanism.
            </p>
            <p>
              Upon depositing, the user interface automatically downloads an <strong>Escape Ticket</strong>
              containing the unhashed <code>salt</code> and <code>deadline</code>. If a swap is
              unfulfilled past its deadline:
            </p>
            <ul>
              <li>
                <strong>1. Request Refund:</strong> The depositor calls
                <code>requestRefund(depositId, deadline, salt)</code> once <code>block.timestamp &gt;= deadline + 180s</code>.
                The contract verifies that <code>keccak256(deadline, salt) == deadlineHash</code>.
              </li>
              <li>
                <strong>2. Challenge Window (10 Minutes):</strong> Anyone in possession of the operator
                secret can call <code>challengeRefund(depositId, secret)</code> to prove that a payout
                with <code>tag = keccak256(depositId, secret)</code> was already settled on-chain.
              </li>
              <li>
                <strong>3. Finalization:</strong> If no challenge occurs within 1 hour,
                <code>finalizeRefund(depositId)</code> transfers 100% of the original deposited asset
                directly back to the depositor.
              </li>
            </ul>
          </section>

          <section id="stealth">
            <h2>06. Stealth Addresses (ERC-5564 & ERC-6538)</h2>
            <p>
              For complete recipient anonymity, Curtain integrates Ethereum Request for Comment
              5564. Senders can specify an ERC-5564 stealth meta-address rather than a public wallet.
            </p>
            <p>
              Using elliptic curve Diffie-Hellman (ECDH) over <code>secp256k1</code>:
            </p>
            <ul>
              <li>The client derives an ephemeral key pair and computes a single-use stealth address.</li>
              <li>An announcement event emits the ephemeral public key and a 1-byte view tag.</li>
              <li>
                The recipient’s client periodically scans announcements using their private viewing key,
                identifying matched transfers without revealing their identity or balances to external observers.
              </li>
            </ul>
          </section>

          <section id="staking">
            <h2>07. Staking & Protocol Tokenomics ($CRTN)</h2>
            <p>
              The Curtain economy aligns keepers, liquidity providers, and long-term participants
              through the <code>CurtainStaking</code> contract and the upcoming <strong>$CRTN</strong>
              governance token.
            </p>
            <p>
              <strong>Lock-Up Tiers & Multipliers:</strong>
            </p>
            <ul>
              <li><strong>30 Days:</strong> 1.0× yield multiplier.</li>
              <li><strong>90 Days:</strong> 1.5× yield multiplier.</li>
              <li><strong>180 Days:</strong> 2.0× yield multiplier.</li>
            </ul>
            <p>
              Protocol swap fees (0.20%) accrue directly to the staking treasury. Stakers receive
              continuous Synthetix-style reward emissions streamed proportionally to weighted
              shares.
            </p>
          </section>

          <section id="threat-model">
            <h2>08. Threat Model & Audit Status</h2>
            <p>
              Curtain’s threat boundary separates operator failure from contract safety:
            </p>
            <ul>
              <li>
                <strong>Operator Downtime:</strong> Neutralized. The contract guarantees full fund
                recovery via the client Escape Ticket.
              </li>
              <li>
                <strong>Front-Running & MEV:</strong> Neutralized. Deposits conceal output tokens and
                recipients; settlement occurs atomically via private bundle submissions.
              </li>
              <li>
                <strong>Operator Key Compromise:</strong> As identified in security review (M-02),
                a compromised operator hot key could attempt to misdirect payouts. Curtain mitigates
                this by enforcing strict allowlists, maximum slippage boundaries, and scheduled
                migration to a multi-party computation (MPC) cluster and decentralized multisig.
              </li>
            </ul>
          </section>
        </article>
      </div>
    </main>
  );
}
