# CRTN staking: stock-bundle rewards

Curtain staking lets a user lock CRTN for a fixed period and earn a USDG-valued reward paid as stock tokens from the reward-pool wallet. The customer guide is published in the documentation site under [CRTN staking](https://docs.curtainrh.com/#staking).

## Reward model

- Base simple APR: 4%.
- 30 days: 1× multiplier (4% APR).
- 90 days: 1.5× multiplier (6% APR).
- 180 days: 2× multiplier (8% APR).
- Accrual stops at the position's fixed maturity; it is not compounded.
- At stake time, the operator signs the current Uniswap V4 CRTN→USDG quote. The contract stores that USDG-denominated principal value.
- At maturity, accrued USDG value is split by the chosen bundle weights. The operator quotes USDG→each constituent stock token with Uniswap V4 and the reward-pool EOA signs one complete claim package.
- The user submits one atomic bundle claim. If any constituent is underfunded or lacks allowance, the transaction reverts as a whole and the accrued reward remains claimable. The principal can be withdrawn independently after maturity.

The stock pool is an inventory source, not an independent yield source. Pool inventory shortages can delay claims. There is no admin-created schedule or manual reward amount: the contract computes the user's entitlement from the signed stake-time USDG valuation and fixed APR terms.

## Trust and operations

- The operator key signs stake-time price attestations and owns the contract; it cannot withdraw users' CRTN principal.
- The reward-pool EOA signs claim packages and grants token allowances to the staking contract when needed. Its private key must remain server-side as `REWARD_POOL_WALLET_PRIVATE_KEY`.
- The pool wallet must hold enough of every constituent in a user's selected bundle. A lack of inventory or a missing V4 quote prevents claim authorization; it does not consume accrued entitlement.
- Existing bundle definitions are immutable. The owner can append new bundles and assets; it cannot edit existing mixes through this contract.
- Users submit and pay gas for stake, principal withdrawal, and stock-bundle claim transactions.

## Operator configuration

Set these on the operator service:

```env
STOCK_STAKING_ADDR=<deployed CurtainStockStaking address>
STOCK_STAKING_START_BLOCK=<deployment block>
REWARD_POOL_WALLET_PRIVATE_KEY=<server-side reward-pool EOA key>
V4_QUOTER_ADDR=<configured Uniswap V4 quoter>
```

The frontend fetches the active staking address and bundle definitions from `/api/curtain/staking/config`; do not configure private keys or quote secrets in frontend variables.

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

Weights determine the intended USDG value split at claim time; they do not specify fixed share counts.
