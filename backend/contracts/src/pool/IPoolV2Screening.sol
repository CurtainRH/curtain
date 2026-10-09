// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Screening-attestation boundary used by the experimental Pool V2 stack.
interface IPoolV2Screening {
    function consumeScreeningProof(bytes calldata proof, bytes32 root, bytes32 nullifier) external;
}
