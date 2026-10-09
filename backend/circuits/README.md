# Curtain Pool v2 circuits

This workspace contains the proving primitives for the externally named Curtain V4 route.
The Solidity pool is not deployable until the full circuit set and generated verifier are
reviewed.

Current primitive:

- `pool_note.circom`: Poseidon commitment binding note secret, token identifier, and amount.
- `pool_spend.circom`: fixed-depth Merkle membership and nullifier derivation primitive.
- `pool_screening.circom`: fixed-depth approved-screening membership and scoped nullifier primitive.
- `pool_transfer.circom`: one-input/two-output private move with exact amount conservation.
- `poolSpendWitness.mjs`: deterministic Poseidon root/nullifier and witness-input builder.
- `poolScreeningWitness.mjs`: deterministic screening-root/nullifier and witness-input builder.
- `poolTransferWitness.mjs`: deterministic transfer-root/nullifier/commitment and witness-input builder.
- `proveTransferGroth16.mjs`: JavaScript Groth16 reference prover for a prepared proving key.
- `proveTransferRapidsnark.mjs`: native Rapidsnark-compatible Groth16 prover path; it reuses the
  same circuit and proving key, then verifies the result with `snarkjs`.

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

## CI verifier build

Run the manual `pool-v2-verifier` GitHub Actions workflow to compile the transfer circuit, create
a disposable CI Plonk setup, prove and verify a transfer witness, and export the development
Solidity verifier. The workflow uploads the verification key, verifier, and circuit artifact for
review; it does not deploy or commit ceremony artifacts. A production ceremony must use a reviewed
universal Powers of Tau artifact and a separately documented release process.

## Faster proving path

The circuit does not change between Plonk and Groth16. Once a reviewed Groth16 proving key exists,
the native command can be used instead of the JavaScript prover:

```sh
RAPIDSNARK_BIN=/path/to/rapidsnark/prover npm run prove:transfer:rapidsnark
```

The command expects `pool_transfer_groth16_dev.zkey`, calculates the witness, generates a proof
with Rapidsnark, and verifies it against the exported verification key. Rapidsnark accelerates
proof generation; it does not replace the one-time proving-key setup or ceremony review.

## Production verifier artifact

The manual `pool-v2-production-verifier` workflow uses the published BN254 Hermez Powers of Tau
artifact for `2^14` constraints, verifies its pinned Blake2b digest and transcript, adds a circuit-specific
Groth16 contribution, verifies the resulting zkey, and exports the Solidity verifier. The uploaded
files are review artifacts only; deployment remains a separate gated step.

Compile after installing dependencies with:

```sh
npm install
npm run compile:pool
```
