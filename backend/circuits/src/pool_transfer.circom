pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/switcher.circom";
include "circomlib/circuits/comparators.circom";

// Pool V4 private-move primitive. One proven input note is split into exactly two output notes.
// The circuit binds all notes to one token and enforces exact amount conservation. Output
// commitments are public so the pool can append them atomically without revealing their secrets.
template PoolTransfer(DEPTH) {
    signal input secret;
    signal input tokenId;
    signal input amount;
    signal input siblings[DEPTH];
    signal input pathBits[DEPTH];
    signal input outputSecret[2];
    signal input outputAmount[2];

    signal output root;
    signal output nullifier;
    signal output publicTokenId;
    signal output outputCommitment[2];

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

    component outputLeaf[2];
    component outputNonZero[2];
    for (var j = 0; j < 2; j++) {
        outputNonZero[j] = IsZero();
        outputNonZero[j].in <== outputAmount[j];
        outputNonZero[j].out === 0;
        outputLeaf[j] = Poseidon(3);
        outputLeaf[j].inputs[0] <== outputSecret[j];
        outputLeaf[j].inputs[1] <== tokenId;
        outputLeaf[j].inputs[2] <== outputAmount[j];
        outputCommitment[j] <== outputLeaf[j].out;
    }

    amount === outputAmount[0] + outputAmount[1];

    component nullifierHash = Poseidon(2);
    nullifierHash.inputs[0] <== secret;
    nullifierHash.inputs[1] <== inputLeaf.out;

    root <== level[DEPTH];
    nullifier <== nullifierHash.out;
    publicTokenId <== tokenId;
}

component main = PoolTransfer(16);
