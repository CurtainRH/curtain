# Curtain Pool v2 circuits

This workspace contains the proving primitives for the externally named Curtain V4 route.
The Solidity pool is not deployable until the full circuit set and generated verifier are
reviewed.

Current primitive:

- `pool_note.circom`: Poseidon commitment binding note secret, token identifier, and amount.

Required before deployment:

- Merkle inclusion against an on-chain root history
- Nullifier derivation and non-reuse proofs
- Internal transfer amount conservation
- Unshield authorization and recipient binding
- Proof-of-innocence membership/non-membership policy
- Trusted setup or a transparent proving system, with ceremony artifacts pinned
- Generated Solidity verifier and test vectors

Compile after installing dependencies with:

```sh
npm install
npm run compile:pool
```
