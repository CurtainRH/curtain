// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { CurtainPoolV2 } from "../../src/pool/CurtainPoolV2.sol";
import { IPoolV2Verifier } from "../../src/pool/IPoolV2Verifier.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";

contract PoolV2VerifierStub is IPoolV2Verifier {
    bool public result;

    function setResult(bool result_) external {
        result = result_;
    }

    function verify(bytes calldata, bytes32[] calldata) external view returns (bool) {
        return result;
    }
}

contract CurtainPoolV2Test is Test {
    MockERC20 token;
    PoolV2VerifierStub verifier;
    CurtainPoolV2 pool;
    address alice = address(0xA11CE);

    function setUp() public {
        token = new MockERC20("USDG", "USDG");
        verifier = new PoolV2VerifierStub();
    pool = new CurtainPoolV2(address(verifier), address(verifier), _tokens(address(token)), address(this));
        token.mint(alice, 100 ether);
        vm.prank(alice);
        token.approve(address(pool), type(uint256).max);
    }

    function _tokens(address token_) internal pure returns (address[] memory tokens) {
        tokens = new address[](1);
        tokens[0] = token_;
    }

    function testShieldRecordsOpaqueCommitmentAndBalance() public {
        vm.prank(alice);
        pool.shield(address(token), 10 ether, bytes32(uint256(1)));
        assertTrue(pool.commitments(bytes32(uint256(1))));
        assertEq(pool.shieldedBalance(address(token)), 10 ether);
        assertEq(token.balanceOf(address(pool)), 10 ether);
    }

    function testMoveRequiresVerifierAndConsumesNullifiers() public {
        bytes32[] memory inputs = new bytes32[](1);
        inputs[0] = bytes32(uint256(11));
        bytes32[] memory outputs = new bytes32[](1);
        outputs[0] = bytes32(uint256(22));
        pool.appendRoot(bytes32(uint256(7)));
        vm.expectRevert(CurtainPoolV2.InvalidProof.selector);
        pool.move(hex"", bytes32(uint256(7)), inputs, outputs, address(token));
        verifier.setResult(true);
        pool.move(hex"", bytes32(uint256(7)), inputs, outputs, address(token));
        assertTrue(pool.nullifierSpent(inputs[0]));
        assertTrue(pool.commitments(outputs[0]));
    }

    function testUnshieldRequiresVerifierAndCannotSpendNullifierTwice() public {
        verifier.setResult(true);
        bytes32 nullifier = bytes32(uint256(33));
        pool.appendRoot(bytes32(uint256(7)));
        vm.prank(alice);
        pool.shield(address(token), 10 ether, bytes32(uint256(44)));
        pool.unshield(hex"", bytes32(uint256(7)), nullifier, address(token), 3 ether, alice);
        assertEq(pool.shieldedBalance(address(token)), 7 ether);
        vm.expectRevert(abi.encodeWithSelector(CurtainPoolV2.NullifierAlreadySpent.selector, nullifier));
        pool.unshield(hex"", bytes32(uint256(7)), nullifier, address(token), 1 ether, alice);
    }

    function testRootHistoryRejectsUnknownRootsAndUnauthorizedPublishers() public {
        bytes32 root = bytes32(uint256(7));
        bytes32[] memory inputs = new bytes32[](1);
        inputs[0] = bytes32(uint256(11));
        bytes32[] memory outputs = new bytes32[](1);
        outputs[0] = bytes32(uint256(22));

        vm.expectRevert(abi.encodeWithSelector(CurtainPoolV2.UnknownRoot.selector, root));
        pool.move(hex"", root, inputs, outputs, address(token));

        vm.prank(alice);
        vm.expectRevert(CurtainPoolV2.UnauthorizedRootManager.selector);
        pool.appendRoot(root);

        pool.appendRoot(root);
        assertTrue(pool.knownRoot(root));
        assertEq(pool.currentRoot(), root);

        vm.expectRevert(abi.encodeWithSelector(CurtainPoolV2.DuplicateRoot.selector, root));
        pool.appendRoot(root);
    }

    function testFixedOneToTwoMoveMatchesTransferPublicInputs() public {
        bytes32 root = bytes32(uint256(7));
        bytes32 nullifier = bytes32(uint256(11));
        bytes32 output0 = bytes32(uint256(22));
        bytes32 output1 = bytes32(uint256(33));
        pool.appendRoot(root);

        vm.expectRevert(CurtainPoolV2.InvalidProof.selector);
        pool.moveOneToTwo(hex"", root, nullifier, output0, output1, address(token));

        verifier.setResult(true);
        pool.moveOneToTwo(hex"", root, nullifier, output0, output1, address(token));
        assertTrue(pool.nullifierSpent(nullifier));
        assertTrue(pool.commitments(output0));
        assertTrue(pool.commitments(output1));

        vm.expectRevert(abi.encodeWithSelector(CurtainPoolV2.DuplicateCommitment.selector, bytes32(uint256(44))));
        pool.moveOneToTwo(hex"", root, bytes32(uint256(44)), bytes32(uint256(44)), bytes32(uint256(44)), address(token));

        vm.expectRevert(abi.encodeWithSelector(CurtainPoolV2.NullifierAlreadySpent.selector, nullifier));
        pool.moveOneToTwo(hex"", root, nullifier, bytes32(uint256(44)), bytes32(uint256(55)), address(token));
    }
}
