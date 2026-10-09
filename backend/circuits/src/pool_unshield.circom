pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/switcher.circom";
include "circomlib/circuits/comparators.circom";

// Pool V2 unshield proof. The public outputs match CurtainPoolV2.unshield exactly:
// root, nullifier, token id, amount, and recipient.
template PoolUnshield(DEPTH) {
    signal input secret;
    signal input tokenId;
    signal input amount;
    signal input nullifierNonce;
    signal input siblings[DEPTH];
    signal input pathBits[DEPTH];
    signal input recipient;

    signal output root;
    signal output nullifier;
    signal output publicTokenId;
    signal output publicAmount;
    signal output publicRecipient;

    component inputLeaf = Poseidon(3);
    inputLeaf.inputs[0] <== secret;
    inputLeaf.inputs[1] <== tokenId;
    inputLeaf.inputs[2] <== amount;

    signal level[DEPTH + 1];
    component branch[DEPTH];
    component select[DEPTH];
    level[0] <== inputLeaf.out;
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

    component inputNonZero = IsZero();
    inputNonZero.in <== amount;
    inputNonZero.out === 0;

    component recipientNonZero = IsZero();
    recipientNonZero.in <== recipient;
    recipientNonZero.out === 0;

    root <== level[DEPTH];
    component nullifierHash = Poseidon(2);
    nullifierHash.inputs[0] <== secret;
    nullifierHash.inputs[1] <== nullifierNonce;
    nullifier <== nullifierHash.out;
    publicTokenId <== tokenId;
    publicAmount <== amount;
    publicRecipient <== recipient;
}

component main = PoolUnshield(16);
