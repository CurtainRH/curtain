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
| `CurtainPoolV2` (product route V4) | `0x80334FD4160245c2856C20526349c43E8597125E` |
| `PoolV2RootManager` | `0x0C6153A8F30fF138A4B477C5a8A702D23fBa865D` |
| `PoolV2TransferVerifierAdapter` | `0xC5DFb62f936402005Db9ca3dC9B1177679a8a0eF` |
| `PoolV2UnshieldVerifierAdapter` | `0x84934df3E763244bA7b4989b63110B2Dae5bf682` |
| Generated transfer Groth16 verifier | `0x0DF4b72342e67455eAB6680Fdb4ddD93A5eb8f9A` |
| Generated unshield Groth16 verifier | `0xD24eA37425CF5D3476FB366caBb80339Ad11862b` |

The canonical deployment record is [`deployments/4663.json`](deployments/4663.json).

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
POOL_V2_GENERATED_VERIFIER_ADDR=0x...
POOL_V2_TOKEN_ADDRS=0x...,0x...
POOL_V2_ROOT_MANAGER_OWNER=0x...
POOL_V2_ROOT_PUBLISHER=0x...
PRIVATE_KEY=0x...

forge script script/DeployPoolV4.s.sol:DeployPoolV4Script \
  --rpc-url "$RPC_HTTP" --broadcast --legacy
```

## Integration order

The product rollout is intentionally staged:

1. **Curtain Swap (`swap.curtainrh.com`)** — add the V4 route choice, point the client at the deployed V4 addresses, and validate shield/proof/unshield flows while leaving existing V2 and V3 vault flows unchanged.
2. **Main dashboard** — add V4 to the existing version/privacy choice and dynamic-privacy routing after the standalone Swap flow is validated.
3. **Operator/API/keeper** — expose V4 configuration, proof preparation, root publication, and settlement only after the client flow passes end-to-end checks.

Do not rename the Solidity contracts or deployment keys to `PoolV4`; reserve V4 for the product/API boundary.
