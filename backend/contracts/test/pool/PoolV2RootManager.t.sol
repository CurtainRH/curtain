// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolV2RootManager} from "../../src/pool/PoolV2RootManager.sol";

contract PoolV2RootConsumerStub {
    bytes32 public lastRoot;
    uint256 public calls;

    function appendRoot(bytes32 root) external {
        lastRoot = root;
        calls++;
    }
}

contract PoolV2RootManagerTest is Test {
    address internal owner = address(0xA11CE);
    address internal publisher = address(0xB0B);
    address internal nextPublisher = address(0xCAFE);
    PoolV2RootManager internal manager;
    PoolV2RootConsumerStub internal pool;

    function setUp() public {
        manager = new PoolV2RootManager(owner, publisher);
        pool = new PoolV2RootConsumerStub();
    }

    function testOwnerSetsPoolOnceAndPublisherPublishes() public {
        vm.prank(owner);
        manager.setPool(address(pool));

        bytes32 root = bytes32(uint256(123));
        vm.prank(publisher);
        manager.publishRoot(root);

        assertEq(address(manager.pool()), address(pool));
        assertEq(pool.lastRoot(), root);
        assertEq(pool.calls(), 1);
    }

    function testOnlyOwnerCanConfigureAndOwnershipIsTwoStep() public {
        vm.prank(publisher);
        vm.expectRevert();
        manager.setPublisher(nextPublisher);

        vm.prank(owner);
        manager.setPublisher(nextPublisher);
        assertEq(manager.publisher(), nextPublisher);

        address successor = address(0xD00D);
        vm.prank(owner);
        manager.transferOwnership(successor);
        assertEq(manager.owner(), owner);
        vm.prank(successor);
        manager.acceptOwnership();
        assertEq(manager.owner(), successor);
    }

    function testRejectsUninitializedPoolUnauthorizedPublisherAndZeroRoot() public {
        vm.prank(publisher);
        vm.expectRevert(PoolV2RootManager.PoolNotSet.selector);
        manager.publishRoot(bytes32(uint256(1)));

        vm.prank(owner);
        manager.setPool(address(pool));

        vm.prank(address(0xBAD));
        vm.expectRevert(PoolV2RootManager.NotPublisher.selector);
        manager.publishRoot(bytes32(uint256(1)));

        vm.prank(publisher);
        vm.expectRevert(PoolV2RootManager.ZeroRoot.selector);
        manager.publishRoot(bytes32(0));

        vm.prank(owner);
        vm.expectRevert(PoolV2RootManager.PoolAlreadySet.selector);
        manager.setPool(address(pool));
    }
}
