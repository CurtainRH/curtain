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
| `CurtainPoolV2` (product route V4) | `0x38147c547cDE831812CD075166E279B77FF164Cc` |
| `PoolV2RootManager` | `0x51E2aCaC1Fe6b1915D7Eafd24b96B7781cd9AFEf` |
| `PoolV2TransferVerifierAdapter` | `0x0a997c29065e765DF0C66FB746D2683fDfEc8fd5` |
| `PoolV2UnshieldVerifierAdapter` | `0x64260f018073e5E9710A150C2a0938A4Cb57100B` |
| Generated transfer Groth16 verifier | `0x32F392E471977E5378D77ecfD3e0b36CE3AF69a4` |
| Generated unshield Groth16 verifier | `0x9315A7D43165B3aa1044a9d458D2496867AC22eD` |

The canonical deployment record is [`deployments/4663.json`](deployments/4663.json).

The corrected pool was created in block `84199146`. The operator must start its
event scan at that block (or an earlier block) so the first shielded notes are
included in the published tree.

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
3. **Operator/API/keeper** — the first operator layer is now available: it indexes
   `NoteShielded` events, persists note metadata, publishes the append-only Poseidon
   root through `PoolV2RootManager`, and serves witnesses at
   `GET /pool-v4/witness/:commitment`. V4 settlement and client proof submission
   remain gated until the shield/unshield flow is validated end to end.

Operator configuration:

```text
POOL_V2_ADDR=0x38147c547cDE831812CD075166E279B77FF164Cc
POOL_V2_ROOT_MANAGER_ADDR=0x51E2aCaC1Fe6b1915D7Eafd24b96B7781cd9AFEf
POOL_V2_START_BLOCK=84199146
POOL_V2_SWAP_TARGETS=0x...
```

The operator's existing `OPERATOR_PRIVATE_KEY` must be the manager publisher
account for root publication. The service accepts the former `POOL_V4_*` names
as temporary compatibility aliases, but new deployments must use `POOL_V2_*`.
Do not enable these variables until the address values have been checked against
the deployment record and the operator wallet has enough native gas.

The final pool deployment also allowlists the existing Uniswap V3 router and
Uniswap V4 adapter as `POOL_V2_SWAP_TARGETS`. The browser receives quote calldata
from `/pool-v4/quote`; it never invents router calldata locally.

Do not rename the Solidity contracts or deployment keys to `PoolV4`; reserve V4 for the product/API boundary.
