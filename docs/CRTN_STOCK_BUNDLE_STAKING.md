# CRTN stock-bundle staking

Curtain’s stock-bundle staking contract is deployed on Robinhood Chain (chain ID 4663).

- Staking and principal-return token: `$CRTN` — `0x66a844fcbf4705dbde3c97394d5a4c9822e8f35b`
- Stock-bundle staking contract and reward treasury: `0xf97DE94DA75923e31c5a8cdf8C048E611aDe3892`
- Contract source: `backend/contracts/src/staking/CurtainStockStaking.sol`
- Deployment manifest: `backend/contracts/deployments/4663.json` (`stockStaking`)

## How it works

Users select a bundle, stake CRTN, and choose a 30-, 90-, or 180-day lock. The existing 1×, 1.5×, and 2× lock weights apply to the stock rewards. At maturity, the user withdraws the original CRTN principal and the accumulated rewards in each funded stock token in that bundle. There is no early withdrawal or separate early reward claim.

The three deployed immutable bundles are:

| ID | Bundle | Target mix |
|---:|---|---|
| 1 | Market Core | SPY 60%, QQQ 40% |
| 2 | AI & Chips | SMH 40%, NVDA 25%, TSM 20%, AMD 15% |
| 3 | Platform Leaders | AAPL, MSFT, AMZN, GOOGL, META 20% each |

The percentages describe the intended mix; they are not market-value rebalanced on-chain. There is no price oracle. Rewards accrue only in the actual constituent tokens funded into the corresponding bundle, so no APR or payout amount is promised.

## Funding a bundle

Funding is permissionless. Any wallet may fund a constituent; each token is funded separately and streams linearly for the selected duration. For example, bundle 1 can be funded with SPY and QQQ in separate calls:

```text
approve(stakingContract, amount)
fundReward(1, SPY, amount, durationSeconds)

approve(stakingContract, amount)
fundReward(1, QQQ, amount, durationSeconds)
```

A direct token transfer to the contract does not start rewards. The asset must be a constituent of the chosen bundle. Fee-on-transfer tokens are rejected. Emissions pause while that bundle has no active stake, preserving the unstreamed balance for later participants.

## Registry and custody

Bundle mixes and registered reward assets are append-only: the owner can register stock assets and add new bundles for future positions, but cannot edit or remove existing definitions. A position stays tied to the bundle ID it selected. The contract has no owner withdrawal, rescue, or sweep function. CRTN and the USDG contract are explicitly rejected as reward assets; they cannot be added to a bundle.

The operator is the registry owner, not a treasury custodian. Anyone can fund the treasury; only the position owner can withdraw their matured principal and rewards. The contract is not a price oracle, stock issuer, or guarantee of investment return.

An earlier deployment (`0xf024145CcCb2d67185FB7883Ca891456cba72454`) was superseded before funding because its registry did not explicitly block USDG. On-chain checks showed zero positions, staked CRTN, and USDG balance at that address. Do not use or fund it; use the address above.
