// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Verifier boundary for CurtainPoolV2.
/// @dev The production verifier must be generated from the reviewed Pool v2 circuits. The pool
/// never ships with a permissive verifier and refuses a zero verifier at construction time.
interface IPoolV2Verifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}
