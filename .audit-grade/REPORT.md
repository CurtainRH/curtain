# Audit Grade — curtain

**Grade: 9.4 / 10** · Rubric v2
Commit `e2138ef` · Mode `full` · 2026-10-07
Previous: none (first audit-grade run) · Studio policy: 8/8 pass
Deployed build: matches audited commit (verified on Robinhood Chain EVM 4663)
Independent check: agreed within 0.3

---

## Path to 9/10 (Optimization to 9.8)

| # | Fix | Where | Points | Effort | Proof for rescore |
| - | --- | ----- | ------ | ------ | ----------------- |
| 1 | Add Gitleaks secret scanner & Slither static analysis to CI | `.github/workflows/backend.yml` | +0.20 | S (1h) | CI runs `gitleaks` and `slither` steps on push |
| 2 | SHA-pin GitHub Actions in CI workflows | `.github/workflows/backend.yml:19` | +0.10 | S (1h) | All `uses:` actions pinned to 40-char commit SHAs |
| 3 | Pin Redis image to patched security release | `backend/docker-compose.yml:23` | +0.05 | S (1h) | Image pinned to `redis:7.4.2-alpine` (clearing CVE-2025-49844) |
| 4 | Add automated on-chain verification script | `backend/contracts/script/PostDeployCheck.s.sol` | +0.05 | S (1h) | `forge script PostDeployCheck.s.sol` executes and passes |
| 5 | Pin floating carets on critical dependency viem | `backend/package.json:21` | +0.04 | S (1h) | `"viem": "2.57.0"` without `^` |

Projected grade after items 1–5: **9.8 / 10**

Studio policy fixes: None (all 8 policies passed).
Later: Slither mutation testing suite execution (+0.15 in C).

---

## Score breakdown

| Category | Score | Weight | Weighted | Change | Main deductions |
| :------- | :---: | :----: | :------: | :----: | :-------------- |
| **A Core security** | 10.0 | 35% | 3.500 | — | Clean: zero open Critical, High, or Medium findings |
| **B Off-chain security** | 10.0 | 15% | 1.500 | — | Clean: operator rate limiting, RPC chunking, secret redaction |
| **C Testing & verification** | 9.0 | 15% | 1.350 | — | 95.6% core coverage, 100k invariant calls; mutation not run (−1.0) |
| **D Privileged ops & deploy** | 9.5 | 10% | 0.950 | — | Immutable contracts, 2-step ownership; post-deploy manual vs script (−0.5) |
| **E Dependencies & supply chain** | 7.7 | 5% | 0.385 | — | Floating `^` on viem (−0.75), unpinned redis image tag (−1.0) |
| **F Hygiene & CI** | 8.0 | 10% | 0.800 | — | Actions not SHA-pinned (−1.0), no static analysis/gitleaks in CI (−1.0) |
| **G Docs & threat model** | 10.0 | 10% | 1.000 | — | Full architecture specs, invariant mappings, honest boundaries |
| **Total before caps** | | | **9.485** | | **9.4 / 10** |
| **Binding Cap** | | | **none** | | Zero open High/Medium, Solvency invariants verified |

---

## Scope

- **Stack**: Solidity (Foundry 0.8.26), Bun / TypeScript backend services, TanStack Start frontend (out of scope).
- **Protocol Types**: Non-custodial Privacy Pool / Dark Pool / Stealth Address Router (Robinhood Chain EVM 4663), Uniswap v3/v4 execution, lock-tier staking.
- **Lanes Run**: `repo-hygiene`, `supply-chain-ci`, `studio-policy`, `evm-stack`, `offchain-backend`, `zk-privacy`, `deploy-verification`.

| Tool | Result | Output |
| :--- | :----- | :----- |
| `detect_stack.sh` | ran · EVM, TS tests, deploy artifacts detected | `.audit-grade/runs/20261007-150600/detect.txt` |
| `hygiene_scan.sh` | ran · 0 secrets in history, 1 image version flag | `.audit-grade/runs/20261007-150600/hygiene.txt` |
| `studio_checks.sh` | ran · 8/8 studio policies pass, 0 APY strings in copy | `.audit-grade/runs/20261007-150600/studio.txt` |
| `forge test` | ran · 50/50 test suites passed | foundry output |
| `forge coverage` | ran · 95.63% in-scope core lines covered | summary table |
| `forge invariant` | ran · 100,000 calls executed without violation | invariant log |
| `bun test` | ran · 27/27 unit tests passed | bun test log |
| `cast (RPC verification)` | ran · Live on-chain assertions verified on 4663 | cast calls |

---

## Deploy verification

- **Network**: Robinhood Chain Mainnet (EVM 4663)
- **RPC**: `https://rpc.mainnet.chain.robinhood.com`
- **CurtainVault (V2)**: `0xF9381841e982648c178E762116A437Ecbcf12Bbd`
  - `owner()`: `0x7f9189564bbeB6f09a500B2D87860Fa24C34CE8B` (Deployer)
  - `pendingOwner()`: `0x1783a60b7f177A4E940Da53e1e92C8D073e8C4f5` (Admin multisig handoff pending)
  - `operator()`: `0x7f9189564bbeB6f09a500B2D87860Fa24C34CE8B`
  - `depositsPaused()`: `false` (Operational)
  - `CHALLENGE_WINDOW`: `1 hours`
  - Exit gating: **None** (`requestRefund` and `finalizeRefund` remain callable unconditionally after deadline)
- **StealthRegistry (V2)**: `0xeA4cE314503AdC39E7a6a01B0A45AB167Fbb7625`
  - `nonceOf(...)`: `0` (ERC-6538 replay protection live)
  - Verification verdict: **MATCHES AUDITED COMMIT**

---

## Findings

### [supply-chain|docker-compose|redis-cve-2025-49844] Unpinned Redis 7 image vulnerable to CVE-2025-49844
- **Severity**: Low
- **Location**: `backend/docker-compose.yml:23`
- **Description**: `redis:7-alpine` uses a floating minor tag subject to upstream package drifts and CVE-2025-49844.
- **Remediation**: Pin to `redis:7.4.2-alpine` or pin by exact Docker image SHA digest.

### [supply-chain|package-json|floating-viem-pin] Floating caret on security-critical library viem
- **Severity**: Low
- **Location**: `backend/package.json:21`
- **Description**: `viem` is pinned with `^2.57.0`. Subordinate installs could pull unanticipated minor releases.
- **Remediation**: Remove `^` and pin exact version `"2.57.0"`.

### [ci|backend-yml|unpinned-actions-no-scanner] Actions use tag pins without SHA and lack Gitleaks in CI
- **Severity**: Low
- **Location**: `.github/workflows/backend.yml:19`
- **Description**: CI workflow uses mutable major tags (`actions/checkout@v4`) and lacks automated secret scanning before container publishing.
- **Remediation**: Pin actions to full 40-character commit SHAs and add a `gitleaks` scan step.

---

## Studio policy — 8/8 Pass

| # | Rule | Result | Evidence |
| - | ---- | :----: | :------- |
| **P1** | **Exit never gated** | **PASS** | `requestRefund` and `finalizeRefund` have zero pause checks; exits always remain open |
| **P2** | **Non-upgradeable by default** | **PASS** | `CurtainVault`, `StealthRegistry`, `CRTN`, and `CurtainStaking` are 100% immutable |
| **P3** | **Fresh deployer per brand** | **PASS** | Distinct keys and contracts configured for Curtain |
| **P4** | **Tokenomics 80/10/5/5** | **PASS** | `CRTN.sol` constructor mints exactly 80% Community, 10% Team, 5% Backers, 5% Reserve |
| **P5** | **No yield / APY language** | **PASS** | Repo copy strictly adheres to "NAV accrual" and explicitly bans "APY" / "guaranteed" |
| **P6** | **No endorsement language** | **PASS** | Robinhood referenced solely as execution chain substrate; zero "official partner" claims |
| **P7** | **Sibling brands never cross-mention**| **PASS** | 0 cross-brand leakage hits in tree or history |
| **P8** | **Honest boundaries documented** | **PASS** | Trust boundaries, off-chain operator scope, and escape hatch detailed in `Curtain_Overview.md` |

---

## Fixed since last run

- `H-1`: Amount linkability & inversion math resolved via UI buckets, privacy scoring, and multi-split payouts.
- `H-2`: Operator unhandled error DoS & unbounded `getLogs` resolved with 2k-block log chunking and dust breaker.
- `H-3`: Web proxy SSRF & Vercel XSS flag remediated with strict `/api/curtain/*` validation.
- `M-1`: Swap surplus extraction resolved with on-chain pro-rata surplus rebate in `CurtainVault.settle()`.
- `M-2`: Operator intent flooding mitigated with sliding-window IP rate limiting and 32KB body ceiling.
- `L-1`: ERC-6538 signature replay resolved via `incrementNonce()` and automatic nonce increments in `StealthRegistry.sol`.

---

## Accepted risks

None. All historical findings have been fully remediated and verified in code and on-chain.

---

## Unverified leads

None.

---

## Checklist detail (C, D, E, F, G)

### Category C — Testing & verification (9.0 / 10.0)
- `1.5 / 1.5`: Build passes and all 50 Foundry tests and 27 Bun unit tests pass.
- `1.5 / 1.5`: Line coverage on core contracts is 95.63% (`CurtainVault.sol` 96.3%, `CurtainStaking.sol` 95.4%, `StealthRegistry.sol` 100%).
- `1.0 / 1.0`: Negative tests cover unauthorized signers, bad deadlines, unlisted tokens, expired secrets, and caller checks.
- `1.0 / 1.0`: Stateless fuzzing tests implemented in `Fuzz.t.sol` (`testFuzz_unsettledDepositAlwaysRefundable`, `testFuzz_neverPaysMoreThanFunded`).
- `2.0 / 2.0`: Stateful invariant tests run 100,000 calls without failure (`invariant_vaultSolvency`, `invariant_conservationOfDeposits`, `invariant_noDoubleClaim`, `invariant_settledConsistency`, `invariant_feeCaps`).
- `0.0 / 1.0`: Mutation score not measured in this run.
- `1.0 / 1.0`: Integration tests against Uniswap v4 routing and operator order lifecycle.
- `0.5 / 0.5`: Core math is standard linear fee subtraction and pro-rata multiplication with overflow protection.
- `0.5 / 0.5`: Tests execute in GitHub Actions CI on every push and PR.

### Category D — Privileged ops & deploy (9.5 / 10.0)
- `1.5 / 1.5`: Privileged roles (Owner, PendingOwner, Operator, Keeper) fully documented with authority matrix.
- `1.5 / 1.5`: Ownership transfer initiated to Admin multisig `0x1783a60b7f177A4E940Da53e1e92C8D073e8C4f5` via `transferOwnership`.
- `1.5 / 1.5`: All core contracts are 100% immutable (non-upgradeable).
- `1.0 / 1.0`: Pause halts new deposits only; emergency exits remain permanently accessible (P1).
- `1.0 / 1.0`: Admin fee setter strictly bounded (`MAX_FEE_BPS = 500 bps / 5%`) and emits events.
- `1.0 / 1.0`: Reproducible deployment script in `backend/contracts/script/DeployV2.s.sol`.
- `1.0 / 1.5`: Live on-chain parameters verified via RPC calls. Dedicated automated check script recommended.
- `1.0 / 1.0`: Health checks and operator monitoring configured.

### Category E — Dependencies & supply chain (7.7 / 10.0)
- `2.0 / 2.0`: Lockfiles committed (`bun.lock`) and installs frozen in CI.
- `0.75 / 1.5`: Submodules pinned to exact commits; package.json uses floating caret on `viem`.
- `2.5 / 2.5`: Zero reachable high/critical CVEs in core library dependencies.
- `1.0 / 1.5`: Install cooldown configured (`minimumReleaseAge = 86400`).
- `1.0 / 1.0`: No unexplained third-party library forks.
- `0.5 / 0.5`: Git submodules pinned to explicit commit SHAs.
- `0.0 / 1.0`: `redis:7-alpine` image unpinned to exact patch.

### Category F — Hygiene & CI (8.0 / 10.0)
- `3.0 / 3.0`: 0 secrets in repository tree or git history.
- `0.5 / 0.5`: `.env` files strictly gitignored; `.env.example` provided.
- `1.5 / 1.5`: CI workflow builds, typechecks, and tests automatically.
- `0.0 / 1.0`: Static analysis tools (Slither/Aderyn) not yet automated in CI.
- `0.5 / 1.5`: GitHub Actions use mutable version tags; secret scanner not in workflow.
- `1.0 / 1.0`: `LICENSE` (MIT) and `SECURITY.md` present.
- `1.0 / 1.0`: Toolchain deterministic: `pragma solidity 0.8.26;` fixed, `foundry.toml` pins solc, optimizer, via_ir.
- `0.5 / 0.5`: Zero invisible/bidi Unicode detected in codebase.

### Category G — Docs & threat model (10.0 / 10.0)
- `1.5 / 1.5`: Comprehensive README files for root and backend workspaces.
- `1.5 / 1.5`: In-depth architecture specification in `CURTAIN_V2_SPEC.md` and `Curtain_Backend.md`.
- `2.0 / 2.0`: Formal invariants documented and mapped to tests.
- `1.5 / 1.5`: Threat model and honest boundary disclosure in `Curtain_Overview.md`.
- `1.0 / 1.0`: Extensive NatSpec and TSDoc documentation on all external functions.
- `1.0 / 1.0`: Deployed contract addresses and chain IDs documented in `deployments/4663.json`.
- `1.0 / 1.0`: Full security audit history and remediation matrix tracked.
- `0.5 / 0.5`: Pinned commit hash `e2138ef` recorded.

---
AI audit grade — a strong pre-audit signal, not a substitute for a human audit before large TVL.
