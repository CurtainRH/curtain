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

`CurtainStockStaking` is separate from the legacy single-reward `CurtainStaking` contract. Users lock the deployed CRTN token for 30, 90, or 180 days and select one stock bundle. At maturity, `withdraw` returns the CRTN principal and accrued rewards for each funded constituent in that bundle. There is no early withdrawal or reward-claim path.

- Bundle and reward-asset registries are append-only: the owner may register more stock assets and add new bundles, but cannot edit or remove an existing asset or bundle.
- Anyone may fund a registered bundle constituent by approving the staking contract and calling `fundReward(bundleId, token, amount, duration)`. A direct token transfer does not start emissions.
- The contract has no owner withdrawal, rescue, or sweep function. It rejects CRTN and USDG as reward assets and only pays registered bundle constituents.
- Funding is per constituent. The published 60/40 and other percentages are target-mix metadata, not an on-chain value rebalance: there is no price oracle, and actual rewards depend on which assets are funded and their stream amounts.
- Emissions pause while a bundle has no active stake. Fee-on-transfer stake/reward tokens are rejected. The owner is the operator key and can only append reward assets/bundles through its privileged methods.

Initial bundle definitions: Market Core (SPY 60%, QQQ 40%); AI & Chips (SMH 40%, NVDA 25%, TSM 20%, AMD 15%); Platform Leaders (AAPL, MSFT, AMZN, GOOGL, META 20% each). Deployment uses `script/DeployCurtainStockStaking.s.sol:DeployCurtainStockStakingScript` on Robinhood Chain 4663.

Production CRTN stock-bundle staking on Robinhood Chain: `0xf97DE94DA75923e31c5a8cdf8C048E611aDe3892`, recorded as `stockStaking` in [`deployments/4663.json`](deployments/4663.json). The contract itself is the reward treasury. The earlier instance `0xf024145CcCb2d67185FB7883Ca891456cba72454` has zero stake and reward balances; it is superseded and must not be used.

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
