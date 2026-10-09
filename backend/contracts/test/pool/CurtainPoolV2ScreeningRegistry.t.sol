// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { CurtainPoolV2ScreeningRegistry } from "../../src/pool/CurtainPoolV2ScreeningRegistry.sol";
import { IPoolV2Verifier } from "../../src/pool/IPoolV2Verifier.sol";

contract PoolV2ScreeningVerifierStub is IPoolV2Verifier {
    bool public result;

    function setResult(bool result_) external {
        result = result_;
    }

    function verify(bytes calldata, bytes32[] calldata) external view returns (bool) {
        return result;
    }
}

contract CurtainPoolV2ScreeningRegistryTest is Test {
    PoolV2ScreeningVerifierStub verifier;
    CurtainPoolV2ScreeningRegistry registry;
    address consumer = address(0xC0FFEE);
    address outsider = address(0xBEEF);

    function setUp() public {
        verifier = new PoolV2ScreeningVerifierStub();
        registry = new CurtainPoolV2ScreeningRegistry(address(verifier), address(this), consumer);
    }

    function testOnlyManagerCanPublishRootsAndHistoryIsAppendOnly() public {
        bytes32 root = bytes32(uint256(7));
        vm.prank(outsider);
        vm.expectRevert(CurtainPoolV2ScreeningRegistry.UnauthorizedRootManager.selector);
        registry.appendRoot(root);

        registry.appendRoot(root);
        assertTrue(registry.knownRoot(root));
        assertEq(registry.currentRoot(), root);

        vm.expectRevert(abi.encodeWithSelector(CurtainPoolV2ScreeningRegistry.DuplicateRoot.selector, root));
        registry.appendRoot(root);
    }

    function testConsumesValidScreeningProofOnlyOnce() public {
        bytes32 root = bytes32(uint256(7));
        bytes32 nullifier = bytes32(uint256(8));
        registry.appendRoot(root);

        vm.prank(consumer);
        vm.expectRevert(CurtainPoolV2ScreeningRegistry.InvalidProof.selector);
        registry.consumeScreeningProof(hex"", root, nullifier);

        verifier.setResult(true);
        vm.prank(consumer);
        registry.consumeScreeningProof(hex"", root, nullifier);
        assertTrue(registry.nullifierSpent(nullifier));

        vm.prank(consumer);
        vm.expectRevert(
            abi.encodeWithSelector(CurtainPoolV2ScreeningRegistry.NullifierAlreadySpent.selector, nullifier)
        );
        registry.consumeScreeningProof(hex"", root, nullifier);
    }

    function testRejectsUnknownRootsAndUnauthorizedConsumers() public {
        bytes32 root = bytes32(uint256(7));
        bytes32 nullifier = bytes32(uint256(8));
        vm.prank(consumer);
        vm.expectRevert(abi.encodeWithSelector(CurtainPoolV2ScreeningRegistry.UnknownRoot.selector, root));
        registry.consumeScreeningProof(hex"", root, nullifier);

        registry.appendRoot(root);
        vm.prank(outsider);
        vm.expectRevert(CurtainPoolV2ScreeningRegistry.UnauthorizedConsumer.selector);
        registry.consumeScreeningProof(hex"", root, nullifier);
    }
}
