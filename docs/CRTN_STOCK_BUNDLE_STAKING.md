# CRTN staking: stock-bundle rewards

Curtain staking lets a user lock CRTN for a fixed period and earn a USDG-valued reward paid as stock tokens from the reward-pool wallet. The customer guide is published in the documentation site under [CRTN staking](https://docs.curtainrh.com/#staking).

## Reward model

- Base simple APR: 4%.
- 30 days: 1× multiplier (4% APR).
- 90 days: 1.5× multiplier (6% APR).
- 180 days: 2× multiplier (8% APR).
- Accrual stops at the position's fixed maturity; it is not compounded.
- At stake time, the operator first checks the best available Uniswap V3/V4 CRTN→USDG quote. If neither venue has a quote, it can use Codex.io's CRTN USD market price and treat USD as equivalent to USDG at 1:1. The source is shown to the user before approval; the operator signs the resulting USDG-denominated principal value.
- At maturity, accrued USDG value is split by the chosen bundle weights. The operator checks supported Uniswap V3 fee tiers and standard V4 pools for each USDG→stock quote, selects the highest output for that exact amount, and the reward-pool EOA signs one complete claim package.
- V3 and V4 quote coverage depends on actual pool liquidity and can change over time. The operator checks the supported venues when a stake quote or claim is requested. It has no direct CRTN/USDG quote on either venue (nor a CRTN/WETH V3/V4 hop), so Codex.io is the configured off-chain fallback for CRTN valuation. The fallback requires a positive market price and reported liquidity; a one-off swap is not treated as a durable price oracle.
- The user submits one atomic bundle claim. If any constituent is underfunded or lacks allowance, the transaction reverts as a whole and the accrued reward remains claimable. The principal can be withdrawn independently after maturity.

The stock pool is an inventory source, not an independent yield source. Pool inventory shortages can delay claims. There is no admin-created schedule or manual reward amount: the contract computes the user's entitlement from the signed stake-time USDG valuation and fixed APR terms.

## Trust and operations

- The operator key signs stake-time price attestations and owns the contract; it cannot withdraw users' CRTN principal.
- The reward-pool EOA signs claim packages and grants token allowances to the staking contract when needed. Its private key must remain server-side as `REWARD_POOL_WALLET_PRIVATE_KEY`.
- The pool wallet must hold enough of every constituent in a user's selected bundle. A lack of inventory or an unavailable V3/V4 quote prevents claim authorization; it does not consume accrued entitlement.
- Existing bundle definitions are immutable. The owner can append new bundles and assets; it cannot edit existing mixes through this contract.
- Users submit and pay gas for stake, principal withdrawal, and stock-bundle claim transactions.

## Operator configuration

Set these on the operator service:

```env
STOCK_STAKING_ADDR=<deployed CurtainStockStaking address>
STOCK_STAKING_START_BLOCK=<deployment block>
REWARD_POOL_WALLET_PRIVATE_KEY=<server-side reward-pool EOA key>
CODEX_IO_API_KEY=<server-side Codex.io market-data key>
UNISWAP_QUOTER_ADDR=<configured Uniswap V3 QuoterV2>
DEX_ROUTER_ADDR=<configured Uniswap V3 router>
V4_ADAPTER_ADDR=<configured Uniswap V4 adapter>
V4_QUOTER_ADDR=<configured Uniswap V4 quoter>
```

The frontend fetches the active staking address and bundle definitions from `/api/curtain/staking/config`; do not configure private keys, Codex keys, or quote secrets in frontend variables.

## Deployment

- Contract source: `backend/contracts/src/staking/CurtainStockStaking.sol`.
- Deployment script: `backend/contracts/script/DeployCurtainStockStaking.s.sol`.
- Network: Robinhood Chain, chain ID 4663.
- Current deployment: `0xfabeaf10dd71f269b774c7e69aff52216b1a7a4c` (block `85046791`).
- Deployment manifest: `backend/contracts/deployments/4663.json` (`stockStaking`).
- Before replacing a deployed address, verify that it has no active positions. If positions exist, preserve the prior contract and provide a migration/continued-claim path instead of switching the UI away from it.

## Bundles

| ID | Bundle | Value weights |
|---:|---|---|
| 1 | Market Core | SPY 60%, QQQ 40% |
| 2 | AI & Chips | SMH 40%, NVDA 25%, TSM 20%, AMD 15% |
| 3 | Platform Leaders | AAPL, MSFT, AMZN, GOOGL, META 20% each |
| 4 | Digital Asset Economy | COIN 30%, CRCL 25%, MSTR 25%, GLXY 20% |
| 5 | Health & Everyday | LLY 30%, JNJ 20%, PFE 20%, COST 20%, UPS 10% |

Weights determine the intended USDG value split at claim time; they do not specify fixed share counts.

New bundle registration is append-only: the contract owner adds the name, token addresses, and weights (which must total 100%). Existing bundle mixes cannot be changed. Registration does not fund the reward pool; claims for the new bundles depend on the pool wallet holding enough of each constituent token and the operator being able to quote the payout.
