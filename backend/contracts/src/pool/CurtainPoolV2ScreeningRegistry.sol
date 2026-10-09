// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolV2Verifier } from "./IPoolV2Verifier.sol";
import { IPoolV2Screening } from "./IPoolV2Screening.sol";

/// @notice Experimental screening-attestation registry for the Curtain V4 foundation.
/// @dev A root represents a policy-approved screening set. This contract does not claim that
/// a user is generally "innocent"; it only verifies membership in the configured attestation
/// set. The verifier and root publisher must be reviewed before production deployment.
contract CurtainPoolV2ScreeningRegistry is IPoolV2Screening {
    IPoolV2Verifier public immutable verifier;
    address public immutable rootManager;
    address public immutable consumer;
    mapping(bytes32 => bool) public knownRoot;
    mapping(bytes32 => bool) public nullifierSpent;
    bytes32 public currentRoot;

    error ZeroAddress();
    error UnauthorizedRootManager();
    error UnauthorizedConsumer();
    error ZeroRoot();
    error DuplicateRoot(bytes32 root);
    error UnknownRoot(bytes32 root);
    error ZeroNullifier();
    error NullifierAlreadySpent(bytes32 nullifier);
    error InvalidProof();

    event RootAdded(bytes32 indexed root);
    event ScreeningProofConsumed(bytes32 indexed root, bytes32 indexed nullifier);

    constructor(address verifier_, address rootManager_, address consumer_) {
        if (verifier_ == address(0) || rootManager_ == address(0) || consumer_ == address(0)) {
            revert ZeroAddress();
        }
        verifier = IPoolV2Verifier(verifier_);
        rootManager = rootManager_;
        consumer = consumer_;
    }

    function appendRoot(bytes32 root) external {
        if (msg.sender != rootManager) revert UnauthorizedRootManager();
        if (root == bytes32(0)) revert ZeroRoot();
        if (knownRoot[root]) revert DuplicateRoot(root);
        knownRoot[root] = true;
        currentRoot = root;
        emit RootAdded(root);
    }

    function consumeScreeningProof(bytes calldata proof, bytes32 root, bytes32 nullifier) external {
        if (msg.sender != consumer) revert UnauthorizedConsumer();
        if (!knownRoot[root]) revert UnknownRoot(root);
        if (nullifier == bytes32(0)) revert ZeroNullifier();
        if (nullifierSpent[nullifier]) revert NullifierAlreadySpent(nullifier);

        bytes32[] memory publicInputs = new bytes32[](2);
        publicInputs[0] = root;
        publicInputs[1] = nullifier;
        if (!verifier.verify(proof, publicInputs)) revert InvalidProof();

        nullifierSpent[nullifier] = true;
        emit ScreeningProofConsumed(root, nullifier);
    }
}
