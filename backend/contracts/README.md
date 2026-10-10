## Curtain V4 deployment naming

Curtain calls the new shielded-pool route **V4** at the product and API boundary. The Solidity implementation remains deliberately named **Pool V2** so the contract history is explicit:

| Product/API name | Internal contract boundary |
|---|---|
| V4 pool route | `CurtainPoolV2` |
| V4 root publication | `PoolV2RootManager` |
| V4 proof boundary | `PoolV2TransferVerifierAdapter` |
| V4 generated verifier | production Groth16 verifier wired into the adapter |

There is no separate `PoolV4.sol`. Use V4 in user-facing route selection and API responses; use the Pool V2 names in Solidity, ABIs, deployment scripts, and contract documentation. See [`POOL_V4_RUNBOOK.md`](POOL_V4_RUNBOOK.md) for the deployed addresses, roles, deployment sequence, and integration order.

## CRTN stock-bundle staking

`CurtainStockStaking` is separate from the legacy single-reward `CurtainStaking` contract. Users lock CRTN for 30, 90, or 180 days and select one stock bundle. The base rate is 4% simple APR, multiplied by 1×, 1.5×, or 2× for the selected term. At stake time, the operator signs a Uniswap V4 CRTN/USDG valuation; accrual stops at maturity. At maturity, a single backend-signed package quotes and pays the complete stock bundle from the reward-pool EOA. `withdraw` returns CRTN principal independently; users submit and pay gas for both transactions.

- Bundle and reward-asset registries are append-only: the owner may register more stock assets and add new bundles, but cannot edit or remove an existing asset or bundle.
- Stock inventory remains in the EOA reward pool. The operator approves each bundle token to the staking contract as needed while preparing a claim; no tokens are held by the contract.
- `claimStockRewards(positionId, rewardUsd, tokens, amounts, deadline, signature)` transfers the full bundle atomically. If any constituent is short or lacks allowance, the entire transaction reverts and accrued rewards remain available.
- The operator signs stake-time quotes and the pool EOA signs claim packages. Both keys must remain server-side. There are no scheduled streams or manually selected reward amounts.
- The contract has no reward withdrawal or rescue method. It rejects CRTN and USDG as reward assets and only schedules registered bundle constituents.
- The bundle weights determine the USDG value split at claim time. Current Uniswap V4 quotes determine token quantities, so weights are not fixed share counts.
- Fee-on-transfer stake/reward tokens are rejected. The owner is the operator key and can only append reward assets/bundles through its privileged methods; the contract has no asset withdrawal method.

Initial bundle definitions: Market Core (SPY 60%, QQQ 40%); AI & Chips (SMH 40%, NVDA 25%, TSM 20%, AMD 15%); Platform Leaders (AAPL, MSFT, AMZN, GOOGL, META 20% each). Deployment uses `script/DeployCurtainStockStaking.s.sol:DeployCurtainStockStakingScript` on Robinhood Chain 4663.

Production CRTN stock-bundle staking on Robinhood Chain: `0xfabeaf10dd71f269b774c7e69aff52216b1a7a4c` (deployment block `85046791`), recorded as `stockStaking` in [`deployments/4663.json`](deployments/4663.json). The separate reward pool EOA is `0x5368049BBb06859e2fC9E78e315b164614097F67`. The prior wallet-backed deployment `0x0852E2B555090dFc537207f3cB2d9D936eDa2e7A` had zero positions and zero CRTN staked when checked before migration; it is superseded by the fixed-APR model.

## Foundry

**Foundry is a blazing fast, portable and modular toolkit for Ethereum application development written in Rust.**

Foundry consists of:

- **Forge**: Ethereum testing framework (like Truffle, Hardhat and DappTools).
- **Cast**: Swiss army knife for interacting with EVM smart contracts, sending transactions and getting chain data.
- **Anvil**: Local Ethereum node, akin to Ganache, Hardhat Network.
- **Chisel**: Fast, utilitarian, and verbose solidity REPL.

## Documentation

https://book.getfoundry.sh/

## Usage

### Build

```shell
$ forge build
```

### Test

```shell
$ forge test
```

### Format

```shell
$ forge fmt
```

### Gas Snapshots

```shell
$ forge snapshot
```

### Anvil

```shell
$ anvil
```

### Deploy

```shell
$ forge script script/Counter.s.sol:CounterScript --rpc-url <your_rpc_url> --private-key <your_private_key>
```

### Cast

```shell
$ cast <subcommand>
```

### Help

```shell
$ forge --help
$ anvil --help
$ cast --help
```
