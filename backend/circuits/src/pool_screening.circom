pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/switcher.circom";

// Screening attestation primitive. The private credential and Merkle path prove membership
// in an approved screening set without revealing the credential leaf. This is an attestation
// boundary, not a general claim about a person's innocence; policy defines the screening set.
template PoolScreening(DEPTH) {
    signal input credentialSecret;
    signal input attestationId;
    signal input scope;
    signal input siblings[DEPTH];
    signal input pathBits[DEPTH];

    signal output root;
    signal output screeningNullifier;

    component leafHash = Poseidon(2);
    leafHash.inputs[0] <== credentialSecret;
    leafHash.inputs[1] <== attestationId;

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
    nullifierHash.inputs[0] <== credentialSecret;
    nullifierHash.inputs[1] <== scope;

    root <== level[DEPTH];
    screeningNullifier <== nullifierHash.out;
}

component main = PoolScreening(16);
