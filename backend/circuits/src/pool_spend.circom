pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/switcher.circom";

// Pool v2 spend primitive. A fixed-depth binary Merkle path proves membership of a note leaf;
// the same secret derives a one-time nullifier. Token and amount are public outputs because the
// ERC-20 transfer must be observable at the pool boundary. Recipient binding is represented by a
// public field hash and will be replaced by the final address-field convention before ceremony.
template PoolSpend(DEPTH) {
    signal input secret;
    signal input tokenId;
    signal input amount;
    signal input nullifierNonce;
    signal input recipientHash;
    signal input siblings[DEPTH];
    signal input pathBits[DEPTH];

    signal output root;
    signal output nullifier;
    signal output publicTokenId;
    signal output publicAmount;
    signal output publicRecipientHash;

    component leafHash = Poseidon(3);
    leafHash.inputs[0] <== secret;
    leafHash.inputs[1] <== tokenId;
    leafHash.inputs[2] <== amount;

    signal level[DEPTH + 1];
    component branch[DEPTH];
    component select[DEPTH];
    level[0] <== leafHash.out;
    for (var i = 0; i < DEPTH; i++) {
        pathBits[i] * (pathBits[i] - 1) === 0;
        select[i] = Switcher();
        select[i].sel <== pathBits[i];
        select[i].L <== level[i];
        select[i].R <== siblings[i];
        branch[i] = Poseidon(2);
        branch[i].inputs[0] <== select[i].outL;
        branch[i].inputs[1] <== select[i].outR;
        level[i + 1] <== branch[i].out;
    }

    component nullifierHash = Poseidon(2);
    nullifierHash.inputs[0] <== secret;
    nullifierHash.inputs[1] <== nullifierNonce;

    root <== level[DEPTH];
    nullifier <== nullifierHash.out;
    publicTokenId <== tokenId;
    publicAmount <== amount;
    publicRecipientHash <== recipientHash;
}

component main = PoolSpend(16);
