# Curtain Pool v2 circuits

This workspace contains the proving primitives for the externally named Curtain V4 route.
The Solidity pool is not deployable until the full circuit set and generated verifier are
reviewed.

Current primitive:

- `pool_note.circom`: Poseidon commitment binding note secret, token identifier, and amount.
- `pool_spend.circom`: fixed-depth Merkle membership and nullifier derivation primitive.
- `pool_screening.circom`: fixed-depth approved-screening membership and scoped nullifier primitive.
- `poolSpendWitness.mjs`: deterministic Poseidon root/nullifier and witness-input builder.
- `poolScreeningWitness.mjs`: deterministic screening-root/nullifier and witness-input builder.

Required before deployment:

- Merkle inclusion against an on-chain root history
- Nullifier derivation and non-reuse proofs
- Internal transfer amount conservation
- Unshield authorization and recipient binding
- Screening attestation membership/non-membership policy
- Trusted setup or a transparent proving system, with ceremony artifacts pinned
- Generated Solidity verifier and test vectors

The screening circuit is intentionally exposed through a separate registry boundary. The pool
must not accept a screening proof until the generated verifier, screening policy, root publisher,
and consumer wiring have all been reviewed together.

Compile after installing dependencies with:

```sh
npm install
npm run compile:pool
```
