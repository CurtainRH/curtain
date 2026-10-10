# CRTN stock-bundle staking

Curtain’s wallet-backed stock-reward staking contract is deployed on Robinhood Chain (chain ID 4663).

- Staking contract: `0x0852E2B555090dFc537207f3cB2d9D936eDa2e7A`
- EOA reward pool: `0x5368049BBb06859e2fC9E78e315b164614097F67`
- CRTN principal token: `0x66a844fcbf4705dbde3c97394d5a4c9822e8f35b`
- Contract source: `backend/contracts/src/staking/CurtainStockStaking.sol`
- Deployment manifest: `backend/contracts/deployments/4663.json` (`stockStaking`)

## User flow

Users choose a bundle and lock CRTN for 30, 90, or 180 days. The lock weights are 1×, 1.5×, and 2× respectively. At maturity, the user can withdraw CRTN principal and claim each accrued stock token separately. The backend signs a claim voucher; the user submits `claimReward` from their connected wallet and pays transaction gas. The contract verifies the signature, position ownership, maturity, accrued amount, and replay nonce before pulling the reward from the pool EOA.

## Funding and scheduling

Send each stock token directly to the reward-pool EOA. A transfer does not itself create a reward schedule. When an authorized schedule is created, the operator API checks the pool balance and automatically submits a one-time unlimited approval for that token if needed, then schedules the rewards. The EOA needs a small ETH balance for this initial approval transaction per token; users pay gas for their own reward claims.

After funding and approval, the operator calls:

```text
scheduleReward(bundleId, tokenAddress, amount, durationSeconds)
```

The contract verifies the EOA has both the balance and allowance to cover already-reserved rewards plus the new schedule. Emissions pause while a bundle has no active stake. Rewards are scheduled per token and bundle. Reward funding/scheduling is not yet exposed in the dashboard; the operator contract call is the current control surface.

The pool private key is used by the backend to sign claim vouchers and approve reward tokens; it must remain server-side as `REWARD_POOL_WALLET_PRIVATE_KEY`. Never put it in frontend/VITE variables. The contract owner is the operator wallet and can append assets/bundles and schedule backed rewards; it cannot withdraw rewards from the pool wallet. The admin scheduling API is protected by `MASTER_ADMIN_KEY`; no admin UI is required.

## Bundles

The deployed immutable bundles are:

| ID | Bundle | Target mix |
|---:|---|---|
| 1 | Market Core | SPY 60%, QQQ 40% |
| 2 | AI & Chips | SMH 40%, NVDA 25%, TSM 20%, AMD 15% |
| 3 | Platform Leaders | AAPL, MSFT, AMZN, GOOGL, META 20% each |

Percentages describe the intended mix; they are not market-value rebalanced. There is no price oracle, and actual rewards depend on the constituent tokens funded and scheduled. No APR or payout amount is promised. CRTN and USDG are rejected as reward assets. Bundle definitions and reward assets are append-only.

## Deployment history

The previous staking contract `0xf97DE94DA75923e31c5a8cdf8C048E611aDe3892` used contract-held stock inventory and has been superseded by the EOA-backed design. Do not fund it. The earlier instance `0xf024145CcCb2d67185FB7883Ca891456cba72454` was also superseded before use. Current position/stake reads on the previous wallet-backed predecessor reported zero positions and zero CRTN staked.
