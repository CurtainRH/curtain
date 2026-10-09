// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IPoolV2Verifier } from "./IPoolV2Verifier.sol";

/// @notice Experimental Pool v2 accounting boundary for Curtain V4.
///
/// This is deliberately a foundation contract, not a deployable privacy system yet. It fixes
/// the immutable token/verifier boundary and the one-way commitment/nullifier accounting that
/// the reviewed circuits must satisfy. Shielding and spending are disabled until a production
/// verifier is wired in; no deployment script should point at this contract before that gate.
contract CurtainPoolV2 {
    using SafeERC20 for IERC20;

    IPoolV2Verifier public immutable verifier;
    IPoolV2Verifier public immutable unshieldVerifier;
    address public immutable rootManager;
    mapping(address => bool) public immutableToken;
    mapping(bytes32 => bool) public commitments;
    mapping(bytes32 => bool) public nullifierSpent;
    mapping(bytes32 => bool) public knownRoot;
    mapping(address => uint256) public shieldedBalance;
    bytes32 public currentRoot;

    error ZeroAddress();
    error EmptyTokenSet();
    error UnsupportedToken(address token);
    error ZeroAmount();
    error ZeroCommitment();
    error DuplicateCommitment(bytes32 commitment);
    error NullifierAlreadySpent(bytes32 nullifier);
    error InvalidProof();
    error BadRecipient();
    error LengthMismatch();
    error UnauthorizedRootManager();
    error ZeroRoot();
    error DuplicateRoot(bytes32 root);
    error UnknownRoot(bytes32 root);

    event RootAdded(bytes32 indexed root);
    event NoteShielded(address indexed token, uint256 amount, bytes32 indexed commitment);
    event NoteMoved(bytes32 indexed root, bytes32[] nullifiers, bytes32[] commitments);
    event NoteUnshielded(address indexed token, uint256 amount, address indexed recipient, bytes32 indexed nullifier);

    constructor(address verifier_, address unshieldVerifier_, address[] memory tokens, address rootManager_) {
        if (verifier_ == address(0)) revert ZeroAddress();
        if (unshieldVerifier_ == address(0)) revert ZeroAddress();
        if (rootManager_ == address(0)) revert ZeroAddress();
        if (tokens.length == 0) revert EmptyTokenSet();
        verifier = IPoolV2Verifier(verifier_);
        unshieldVerifier = IPoolV2Verifier(unshieldVerifier_);
        rootManager = rootManager_;
        for (uint256 i; i < tokens.length; ++i) {
            address token = tokens[i];
            if (token == address(0)) revert ZeroAddress();
            if (immutableToken[token]) revert UnsupportedToken(token);
            immutableToken[token] = true;
        }
    }

    /// @notice Adds a Merkle root to the append-only history accepted by proofs.
    /// @dev The production deployment must make rootManager a constrained tree publisher.
    function appendRoot(bytes32 root) external {
        if (msg.sender != rootManager) revert UnauthorizedRootManager();
        if (root == bytes32(0)) revert ZeroRoot();
        if (knownRoot[root]) revert DuplicateRoot(root);
        knownRoot[root] = true;
        currentRoot = root;
        emit RootAdded(root);
    }

    /// @notice Places a token amount behind a fresh note commitment.
    /// @dev The commitment is opaque; the circuit must bind it to token, amount and note secret.
    function shield(address token, uint256 amount, bytes32 commitment) external {
        if (!immutableToken[token]) revert UnsupportedToken(token);
        if (amount == 0) revert ZeroAmount();
        if (commitment == bytes32(0)) revert ZeroCommitment();
        if (commitments[commitment]) revert DuplicateCommitment(commitment);

        commitments[commitment] = true;
        shieldedBalance[token] += amount;
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit NoteShielded(token, amount, commitment);
    }

    /// @notice Records a shielded note transfer without moving an ERC-20 balance.
    /// @dev The production verifier must prove input ownership, nullifier uniqueness, token and
    /// amount conservation, and that every output commitment is correctly formed.
    function move(
        bytes calldata proof,
        bytes32 root,
        bytes32[] calldata inputNullifiers,
        bytes32[] calldata outputCommitments,
        address token
    ) external {
        if (!immutableToken[token]) revert UnsupportedToken(token);
        if (inputNullifiers.length == 0 || outputCommitments.length == 0) revert LengthMismatch();
        if (!knownRoot[root]) revert UnknownRoot(root);
        bytes32[] memory publicInputs = new bytes32[](3 + inputNullifiers.length + outputCommitments.length);
        publicInputs[0] = root;
        publicInputs[1] = bytes32(uint256(uint160(token)));
        publicInputs[2] = bytes32(inputNullifiers.length);
        for (uint256 i; i < inputNullifiers.length; ++i) {
            publicInputs[3 + i] = inputNullifiers[i];
        }
        for (uint256 i; i < outputCommitments.length; ++i) {
            publicInputs[3 + inputNullifiers.length + i] = outputCommitments[i];
        }
        if (!verifier.verify(proof, publicInputs)) revert InvalidProof();

        for (uint256 i; i < inputNullifiers.length; ++i) {
            bytes32 nullifier = inputNullifiers[i];
            if (nullifier == bytes32(0) || nullifierSpent[nullifier]) revert NullifierAlreadySpent(nullifier);
            nullifierSpent[nullifier] = true;
        }
        for (uint256 i; i < outputCommitments.length; ++i) {
            bytes32 commitment = outputCommitments[i];
            if (commitment == bytes32(0) || commitments[commitment]) revert DuplicateCommitment(commitment);
            commitments[commitment] = true;
        }
        emit NoteMoved(root, inputNullifiers, outputCommitments);
    }

    /// @notice Records the fixed V4 one-input/two-output transfer proof.
    /// @dev The proof binds the input note, token, nullifier, output commitments, and exact
    /// amount conservation. This is the verifier-compatible path for the first production proof
    /// schema; the dynamic move method above remains a compatibility scaffold only.
    function moveOneToTwo(
        bytes calldata proof,
        bytes32 root,
        bytes32 nullifier,
        bytes32 outputCommitment0,
        bytes32 outputCommitment1,
        address token
    ) external {
        if (!immutableToken[token]) revert UnsupportedToken(token);
        if (!knownRoot[root]) revert UnknownRoot(root);
        if (nullifier == bytes32(0) || nullifierSpent[nullifier]) revert NullifierAlreadySpent(nullifier);
        if (outputCommitment0 == bytes32(0) || commitments[outputCommitment0]) {
            revert DuplicateCommitment(outputCommitment0);
        }
        if (outputCommitment1 == bytes32(0) || commitments[outputCommitment1]) {
            revert DuplicateCommitment(outputCommitment1);
        }
        if (outputCommitment0 == outputCommitment1) revert DuplicateCommitment(outputCommitment1);

        bytes32[] memory publicInputs = new bytes32[](5);
        publicInputs[0] = root;
        publicInputs[1] = nullifier;
        publicInputs[2] = bytes32(uint256(uint160(token)));
        publicInputs[3] = outputCommitment0;
        publicInputs[4] = outputCommitment1;
        if (!verifier.verify(proof, publicInputs)) revert InvalidProof();

        nullifierSpent[nullifier] = true;
        commitments[outputCommitment0] = true;
        commitments[outputCommitment1] = true;
        bytes32[] memory inputNullifiers = new bytes32[](1);
        inputNullifiers[0] = nullifier;
        bytes32[] memory outputCommitments = new bytes32[](2);
        outputCommitments[0] = outputCommitment0;
        outputCommitments[1] = outputCommitment1;
        emit NoteMoved(root, inputNullifiers, outputCommitments);
    }

    /// @notice Unshields a proven note to a public recipient.
    /// @dev The production verifier must bind the nullifier, root, token, amount and recipient
    /// to an unspent note and prove that the amount is covered by the pool's accounting.
    function unshield(
        bytes calldata proof,
        bytes32 root,
        bytes32 nullifier,
        address token,
        uint256 amount,
        address recipient
    ) external {
        if (!immutableToken[token]) revert UnsupportedToken(token);
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert BadRecipient();
        if (!knownRoot[root]) revert UnknownRoot(root);
        if (nullifier == bytes32(0) || nullifierSpent[nullifier]) revert NullifierAlreadySpent(nullifier);
        bytes32[] memory publicInputs = new bytes32[](5);
        publicInputs[0] = root;
        publicInputs[1] = nullifier;
        publicInputs[2] = bytes32(uint256(uint160(token)));
        publicInputs[3] = bytes32(amount);
        publicInputs[4] = bytes32(uint256(uint160(recipient)));
        if (!unshieldVerifier.verify(proof, publicInputs)) revert InvalidProof();

        nullifierSpent[nullifier] = true;
        shieldedBalance[token] -= amount;
        IERC20(token).safeTransfer(recipient, amount);
        emit NoteUnshielded(token, amount, recipient, nullifier);
    }
}
