// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolV2Verifier } from "./IPoolV2Verifier.sol";

/// @notice ABI adapter for the generated Plonk verifier for PoolTransfer.
/// @dev Callers ABI-encode one uint256[] proof array. Public inputs remain the five values
/// expected by CurtainPoolV2.moveOneToTwo: root, nullifier, token, commitment0, commitment1.
interface IGeneratedPoolTransferPlonkVerifier {
    function verifyProof(uint256[] calldata proof, uint256[] calldata publicSignals) external view returns (bool);
}

contract PoolV2TransferPlonkVerifierAdapter is IPoolV2Verifier {
    IGeneratedPoolTransferPlonkVerifier public immutable generatedVerifier;

    error ZeroAddress();

    constructor(address generatedVerifier_) {
        if (generatedVerifier_ == address(0)) revert ZeroAddress();
        generatedVerifier = IGeneratedPoolTransferPlonkVerifier(generatedVerifier_);
    }

    function decodeProof(bytes calldata encoded) external pure returns (uint256[] memory) {
        return abi.decode(encoded, (uint256[]));
    }

    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool) {
        if (publicInputs.length != 5 || proof.length < 64) return false;
        uint256[] memory proofValues;
        try this.decodeProof(proof) returns (uint256[] memory decoded) {
            proofValues = decoded;
        } catch {
            return false;
        }
        uint256[] memory signals = new uint256[](5);
        for (uint256 i; i < 5; ++i) {
            signals[i] = uint256(publicInputs[i]);
        }
        try generatedVerifier.verifyProof(proofValues, signals) returns (bool valid) {
            return valid;
        } catch {
            return false;
        }
    }
}
