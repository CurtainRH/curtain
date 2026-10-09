## Curtain V4 deployment naming

Curtain calls the new shielded-pool route **V4** at the product and API boundary. The Solidity implementation remains deliberately named **Pool V2** so the contract history is explicit:

| Product/API name | Internal contract boundary |
|---|---|
| V4 pool route | `CurtainPoolV2` |
| V4 root publication | `PoolV2RootManager` |
| V4 proof boundary | `PoolV2TransferVerifierAdapter` |
| V4 generated verifier | production Groth16 verifier wired into the adapter |

There is no separate `PoolV4.sol`. Use V4 in user-facing route selection and API responses; use the Pool V2 names in Solidity, ABIs, deployment scripts, and contract documentation. See [`POOL_V4_RUNBOOK.md`](POOL_V4_RUNBOOK.md) for the deployed addresses, roles, deployment sequence, and integration order.

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
