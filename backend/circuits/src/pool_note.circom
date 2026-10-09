pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";

// First Pool v2 circuit primitive. The production pool circuit will extend this with
// Merkle membership, nullifier derivation, amount conservation, and screening proofs.
// The commitment binds the note secret, token identifier, and amount before a note enters
// CurtainPoolV2. No address is part of the note commitment.
template PoolNoteCommitment() {
    signal input secret;
    signal input tokenId;
    signal input amount;
    signal output commitment;

    component hash = Poseidon(3);
    hash.inputs[0] <== secret;
    hash.inputs[1] <== tokenId;
    hash.inputs[2] <== amount;
    commitment <== hash.out;
}

component main = PoolNoteCommitment();
