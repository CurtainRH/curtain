// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolV2Verifier } from "./IPoolV2Verifier.sol";

/// @notice ABI adapter between CurtainPoolV2 and a generated Groth16 transfer verifier.
/// @dev The generated verifier is intentionally injected only after the circuit ceremony and
/// verifier review. Proof bytes are abi.encode(uint256[2],uint256[2][2],uint256[2],uint256[5]).
interface IGeneratedPoolTransferVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[5] calldata input
    ) external view returns (bool);
}

contract PoolV2TransferVerifierAdapter is IPoolV2Verifier {
    IGeneratedPoolTransferVerifier public immutable generatedVerifier;

    constructor(address generatedVerifier_) {
        if (generatedVerifier_ == address(0)) revert ZeroAddress();
        generatedVerifier = IGeneratedPoolTransferVerifier(generatedVerifier_);
    }

    error ZeroAddress();

    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool) {
        if (publicInputs.length != 5 || proof.length != 416) return false;
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[5] memory input) =
            abi.decode(proof, (uint256[2], uint256[2][2], uint256[2], uint256[5]));
        for (uint256 i; i < 5; ++i) {
            input[i] = uint256(publicInputs[i]);
        }
        try generatedVerifier.verifyProof(a, b, c, input) returns (bool valid) {
            return valid;
        } catch {
            return false;
        }
    }
}
