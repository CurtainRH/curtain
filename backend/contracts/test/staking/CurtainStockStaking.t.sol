// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { CurtainStockStaking } from "../../src/staking/CurtainStockStaking.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";

contract CurtainStockStakingTest is Test {
    CurtainStockStaking staking;
    MockERC20 crtn;
    MockERC20 spy;
    MockERC20 qqq;
    MockERC20 nvda;
    address admin = address(0xAD);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    uint256 coreBundle;

    function setUp() public {
        vm.warp(1_000_000);
        crtn = new MockERC20("Curtain", "CRTN");
        spy = new MockERC20("SPY", "SPY");
        qqq = new MockERC20("QQQ", "QQQ");
        nvda = new MockERC20("NVDA", "NVDA");
        staking = new CurtainStockStaking(admin, address(crtn));
        vm.startPrank(admin);
        staking.addRewardAsset(address(spy));
        staking.addRewardAsset(address(qqq));
        staking.addRewardAsset(address(nvda));
        address[] memory assets = new address[](2);
        uint16[] memory weights = new uint16[](2);
        assets[0] = address(spy);
        assets[1] = address(qqq);
        weights[0] = 6_000;
        weights[1] = 4_000;
        coreBundle = staking.addBundle("Market Core", assets, weights);
        vm.stopPrank();

        crtn.mint(alice, 1_000 ether);
        crtn.mint(bob, 1_000 ether);
        spy.mint(address(this), 10_000 ether);
        qqq.mint(address(this), 10_000 ether);
        vm.prank(alice);
        crtn.approve(address(staking), type(uint256).max);
        vm.prank(bob);
        crtn.approve(address(staking), type(uint256).max);
        spy.approve(address(staking), type(uint256).max);
        qqq.approve(address(staking), type(uint256).max);
    }

    function test_anyoneCanFundAndMaturedWithdrawalPaysStockBundleAndPrincipal() public {
        vm.prank(alice);
        uint256 id = staking.stake(100 ether, 0, coreBundle);
        vm.prank(bob);
        staking.stake(100 ether, 0, coreBundle);

        // A non-owner funds both immutable bundle constituents.
        staking.fundReward(coreBundle, address(spy), 600 ether, 30 days);
        staking.fundReward(coreBundle, address(qqq), 400 ether, 30 days);
        vm.warp(block.timestamp + 30 days);

        uint256 aliceSpyBefore = spy.balanceOf(alice);
        uint256 aliceQqqBefore = qqq.balanceOf(alice);
        vm.prank(alice);
        staking.withdraw(id);

        assertApproxEqRel(spy.balanceOf(alice) - aliceSpyBefore, 300 ether, 1e12);
        assertApproxEqRel(qqq.balanceOf(alice) - aliceQqqBefore, 200 ether, 1e12);
        assertEq(crtn.balanceOf(alice), 1_000 ether, "principal returned");
        assertEq(staking.reservedRewards(address(spy)), spy.balanceOf(address(staking)));
        assertEq(staking.reservedRewards(address(qqq)), qqq.balanceOf(address(staking)));
    }

    function testCannotWithdrawBeforeLockMatures() public {
        vm.prank(alice);
        uint256 id = staking.stake(100 ether, 1, coreBundle);
        vm.prank(alice);
        vm.expectPartialRevert(CurtainStockStaking.PositionLocked.selector);
        staking.withdraw(id);
    }

    function testBundleDefinitionsAreAppendOnlyAndNewStockAssetsRegisterAtomically() public {
        address[] memory assets = new address[](1);
        uint16[] memory weights = new uint16[](1);
        assets[0] = address(nvda);
        weights[0] = 10_000;
        vm.prank(admin);
        uint256 added = staking.addBundle("AI & Chips", assets, weights);
        (string memory name, address[] memory savedAssets, uint16[] memory savedWeights) = staking.getBundle(added);
        assertEq(name, "AI & Chips");
        assertEq(savedAssets[0], address(nvda));
        assertEq(savedWeights[0], 10_000);
        assertTrue(staking.isRewardAsset(address(nvda)), "new bundle stock is registered atomically");

        assets[0] = address(crtn);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(CurtainStockStaking.InvalidAsset.selector, address(crtn)));
        staking.addBundle("CRTN cannot be a reward", assets, weights);
    }

    function testUSDGAndCRTNCannotBeRewardAssets() public {
        address usdg = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(CurtainStockStaking.InvalidAsset.selector, usdg));
        staking.addRewardAsset(usdg);

        address[] memory assets = new address[](1);
        uint16[] memory weights = new uint16[](1);
        assets[0] = usdg;
        weights[0] = 10_000;
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(CurtainStockStaking.InvalidAsset.selector, usdg));
        staking.addBundle("USDG should not be a reward", assets, weights);
    }

    function testFundingOnlyWorksForBundleConstituents() public {
        nvda.mint(address(this), 100 ether);
        nvda.approve(address(staking), type(uint256).max);
        vm.expectRevert(CurtainStockStaking.InvalidBundle.selector);
        staking.fundReward(coreBundle, address(nvda), 1 ether, 1 days);
    }

    function testStreamsPauseWhenNoStakersAndResumeAfterStake() public {
        staking.fundReward(coreBundle, address(spy), 100 ether, 10 days);
        vm.warp(block.timestamp + 30 days);
        vm.prank(alice);
        uint256 id = staking.stake(100 ether, 0, coreBundle);
        vm.warp(block.timestamp + 10 days);
        assertApproxEqRel(staking.earned(id, address(spy)), 100 ether, 1e12);
    }

    function testMaturedMultiplierCanBeKickedWithoutLosingAccruedRewards() public {
        vm.prank(alice);
        uint256 id = staking.stake(100 ether, 2, coreBundle);
        staking.fundReward(coreBundle, address(spy), 100 ether, 180 days);
        vm.warp(block.timestamp + 180 days);
        uint256 earnedBefore = staking.earned(id, address(spy));
        staking.kick(id);
        assertApproxEqAbs(staking.earned(id, address(spy)), earnedBefore, 1e6);
    }
}
