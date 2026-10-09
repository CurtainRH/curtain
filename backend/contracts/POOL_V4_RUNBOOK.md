# Curtain V4 / Pool V2 runbook

This is the operational record for the new shielded-pool route on Robinhood Chain (chain ID `4663`).

## Naming

- **Product/API route:** V4
- **Solidity pool:** `CurtainPoolV2`
- **Root publisher boundary:** `PoolV2RootManager`
- **Proof boundary:** `PoolV2TransferVerifierAdapter`
- **Generated verifier:** production Groth16 verifier deployed behind the adapter

“Pool V4” is a product label only. There is no `PoolV4.sol` contract. Contract code, ABIs, deployment keys, and internal service names use Pool V2; route selectors, user-facing copy, and API responses may use V4.

## Mainnet deployment

| Component | Address |
|---|---|
| Current `CurtainPoolV2` (product route V4) | `0xA6fcb7A43aE6F26c86EA637D8BA9aaA1fd506971` |
| Current `PoolV2RootManager` | `0x13197b48E467A306F612D0eFBA745963E914B55F` |
| Exact-output `UniswapV4Adapter` for Pool V2 | `0x86FACa7029Ac9c8d6a457DA6c38E12b84eba67a7` |
| Legacy `CurtainPoolV2` (recovery only) | `0x38147c547cDE831812CD075166E279B77FF164Cc` |
| Legacy `PoolV2RootManager` | `0x51E2aCaC1Fe6b1915D7Eafd24b96B7781cd9AFEf` |
| `PoolV2TransferVerifierAdapter` | `0x0a997c29065e765DF0C66FB746D2683fDfEc8fd5` |
| `PoolV2UnshieldVerifierAdapter` | `0x64260f018073e5E9710A150C2a0938A4Cb57100B` |
| Generated transfer Groth16 verifier | `0x32F392E471977E5378D77ecfD3e0b36CE3AF69a4` |
| Generated unshield Groth16 verifier | `0x9315A7D43165B3aa1044a9d458D2496867AC22eD` |

The canonical deployment record is [`deployments/4663.json`](deployments/4663.json).

### Read-only deployment verification

Run the manifest-driven check after a deployment (it sends no transactions):

```sh
forge script script/PostDeployCheck.s.sol:PostDeployCheckScript \
  --rpc-url "$RPC_HTTP"
```

The check verifies the legacy vault/staking/stealth configuration and the current
Pool V2 bytecode, verifier adapters, root-manager linkage, published root, USDG/NVDA
allowlist, and exact-output swap-adapter allowlist. It reads addresses from
`deployments/4663.json`; update that manifest as part of any deployment change.

The current swap-ready pool was created in block `84297845`. Start its event
scan at that block (or earlier). The legacy pool began at block `84199146` and
must remain indexed for recovery of any notes created there. The two pools have
separate database cursors and Merkle trees; never combine their notes or roots.

The current pool was deployed with the existing production transfer and unshield
verifier adapters, the configured supported-token set, the existing Uniswap V3
SwapRouter02, and the new exact-output Uniswap V4 adapter. The earlier pool is
not upgraded in place: immutable allowlists and its former swap behavior require
a fresh deployment.

### Production smoke test

The deployed path was exercised on Robinhood Chain from the operator wallet:

- Swap transaction: `0x3ce8cfe269b6d87f7dce1087feb7e15c5579274525ebd174dad991e6798340e0`
- Root publication: `0xd868fadb2da0591283bc96801be34fa14cec5f2b47855d263109c6d59e517436`
- Unshield transaction: `0x0eae023a17c0df5ce39b9f0afd566b2c4016d28ebf940f0026029444522843cc`
- Input: `0.5 USDG`; exact-output route spent `0.495001 USDG` and returned the remainder.
- Output: `0.002153102797079207 NVDA` was shielded, then unshielded to the operator wallet.
- The unshield receipt succeeded and the note nullifier is marked spent.

The guarded repeatable smoke-test tool is `../circuits/src/testPoolV2MainnetSwap.mjs`.
It requires `POOL_V2_TEST_CONFIRM=EXECUTE_MAINNET_TEST_SWAP` and persists its
recovery note with restrictive file permissions before any transaction.

## Roles and root policy

- `CurtainPoolV2.rootManager()` points to `PoolV2RootManager`.
- The manager is linked to the pool exactly once with `setPool`.
- Only the manager’s `publisher` can publish an accepted Merkle root to the pool.
- The manager uses two-step ownership, so administrative ownership can move to a multisig without changing the publisher immediately.
- The current deployment was initialized with the operator EOA as owner and publisher. Move those roles to the intended production administration/publisher policy before treating root publication as decentralized.

## Production verifier provenance

The production verifier workflow uses the published BN254 Hermez Powers of Tau artifact, verifies its pinned Blake2b-512 digest and transcript, adds circuit-specific Groth16 contributions for both the private-transfer and unshield circuits, verifies both proving keys, and exports both Solidity verifiers. The disposable CI Plonk verifier is not used by this deployment.

## Deployment sequence

1. Generate and review the production verifier artifact.
2. Deploy the generated transfer and unshield verifiers.
3. Deploy `PoolV2TransferVerifierAdapter` and `PoolV2UnshieldVerifierAdapter` against their matching verifiers.
4. Deploy `PoolV2RootManager` with the intended temporary owner and publisher.
5. Deploy `CurtainPoolV2` with both verifier adapters, the supported token list, and root manager.
6. Call `PoolV2RootManager.setPool` once.
7. Transfer manager ownership if the final owner differs from the deployer.
8. Verify all addresses, role values, bytecode, public-input schemas, and deployment records on chain.

Example deployment configuration:

```sh
POOL_V2_TOKEN_ADDRS=0x...,0x...
POOL_V2_ROOT_MANAGER_OWNER=0x...
POOL_V2_ROOT_PUBLISHER=0x...
POOL_V2_SWAP_TARGETS=0x...,0x...
PRIVATE_KEY=0x...

forge script script/DeployPoolV2.s.sol:DeployPoolV2Script \
  --rpc-url "$RPC_HTTP" --broadcast
```

## Integration order

The product rollout is intentionally staged:

1. **Curtain Swap (`swap.curtainrh.com`)** — add the V4 route choice, point the client at the deployed V4 addresses, and validate shield/proof/unshield flows while leaving existing V2 and V3 vault flows unchanged.
2. **Main dashboard** — add V4 to the existing version/privacy choice and dynamic-privacy routing after the standalone Swap flow is validated.
3. **Operator/API/keeper** — the operator layer indexes
   `NoteShielded` events, persists note metadata, publishes the append-only Poseidon
   root through `PoolV2RootManager`, and serves witnesses at
   `GET /pool-v4/witness/:commitment`. V4 settlement and client proof submission
   remain gated until the shield/unshield flow is validated end to end.

Operator configuration for a future controlled rollout (do not set the feature
flag until the frontend integration is ready):

```text
POOL_V2_ADDR=0xA6fcb7A43aE6F26c86EA637D8BA9aaA1fd506971
POOL_V2_ROOT_MANAGER_ADDR=0x13197b48E467A306F612D0eFBA745963E914B55F
POOL_V2_START_BLOCK=84297845
POOL_V2_DEX_ADAPTER_ADDR=0x86FACa7029Ac9c8d6a457DA6c38E12b84eba67a7
POOL_V2_LEGACY_ADDR=0x38147c547cDE831812CD075166E279B77FF164Cc
POOL_V2_LEGACY_ROOT_MANAGER_ADDR=0x51E2aCaC1Fe6b1915D7Eafd24b96B7781cd9AFEf
POOL_V2_LEGACY_START_BLOCK=84199146
FEATURE_POOL_V2_ROUTE=true
```

The operator's existing `OPERATOR_PRIVATE_KEY` must be the manager publisher
account for root publication. The service accepts the former `POOL_V4_*` names
as temporary compatibility aliases, but new deployments must use `POOL_V2_*`.
Do not enable these variables until the address values have been checked against
the deployment record and the operator wallet has enough native gas.

The new pool allowlists the existing Uniswap V3 router and the new exact-output
Uniswap V4 adapter. The operator API builds exact-output calldata for the quoted
output, caps input at the user's deposit, and refunds unused input. Its dedicated
`POOL_V2_DEX_ADAPTER_ADDR` must point to the new adapter; do not replace the
legacy global `V4_ADAPTER_ADDR`, which serves the existing vault routes. The
browser receives quote calldata from `/pool-v4/quote`; it never invents router
calldata locally. The route and UI remain disabled until the operator deployment
and frontend wiring are deliberately enabled.

Do not rename the Solidity contracts or deployment keys to `PoolV4`; reserve V4 for the product/API boundary.
