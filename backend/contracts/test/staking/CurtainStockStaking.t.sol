// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { CurtainStockStaking } from "../../src/staking/CurtainStockStaking.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";

contract CurtainStockStakingTest is Test {
    uint256 constant POOL_KEY = 0xBEEF1234;
    CurtainStockStaking staking;
    MockERC20 crtn;
    MockERC20 spy;
    MockERC20 qqq;
    MockERC20 nvda;
    address admin = address(0xAD);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address pool;
    uint256 coreBundle;

    function setUp() public {
        vm.warp(1_000_000);
        pool = vm.addr(POOL_KEY);
        crtn = new MockERC20("Curtain", "CRTN");
        spy = new MockERC20("SPY", "SPY");
        qqq = new MockERC20("QQQ", "QQQ");
        nvda = new MockERC20("NVDA", "NVDA");
        staking = new CurtainStockStaking(admin, address(crtn));
        vm.startPrank(admin);
        staking.setRewardPoolWallet(pool);
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
        spy.mint(pool, 10_000 ether);
        qqq.mint(pool, 10_000 ether);
        vm.prank(pool);
        spy.approve(address(staking), type(uint256).max);
        vm.prank(pool);
        qqq.approve(address(staking), type(uint256).max);
        vm.prank(alice);
        crtn.approve(address(staking), type(uint256).max);
        vm.prank(bob);
        crtn.approve(address(staking), type(uint256).max);
    }

    function test_walletBackedRewardClaimUserPaysGasAndPrincipalWithdrawsSeparately() public {
        vm.prank(alice);
        uint256 aliceId = staking.stake(100 ether, 0, coreBundle);
        vm.prank(bob);
        staking.stake(100 ether, 0, coreBundle);

        // The stock stays in the EOA. The operator schedules only backed inventory.
        vm.prank(admin);
        staking.scheduleReward(coreBundle, address(spy), 600 ether, 30 days);
        vm.prank(admin);
        staking.scheduleReward(coreBundle, address(qqq), 400 ether, 30 days);
        assertEq(spy.balanceOf(pool), 10_000 ether);
        assertEq(spy.balanceOf(address(staking)), 0);

        vm.warp(block.timestamp + 30 days);
        uint256 spyReward = staking.earned(aliceId, address(spy));
        uint256 qqqReward = staking.earned(aliceId, address(qqq));
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 spyDigest = staking.rewardClaimDigest(aliceId, alice, address(spy), spyReward, deadline);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(POOL_KEY, spyDigest);
        bytes memory spySignature = abi.encodePacked(r1, s1, v1);
        uint256 aliceSpyBefore = spy.balanceOf(alice);
        vm.prank(alice);
        staking.claimReward(aliceId, address(spy), spyReward, deadline, spySignature);
        assertEq(spy.balanceOf(alice) - aliceSpyBefore, spyReward);

        bytes32 qqqDigest = staking.rewardClaimDigest(aliceId, alice, address(qqq), qqqReward, deadline);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(POOL_KEY, qqqDigest);
        uint256 aliceQqqBefore = qqq.balanceOf(alice);
        vm.prank(alice);
        staking.claimReward(aliceId, address(qqq), qqqReward, deadline, abi.encodePacked(r2, s2, v2));
        assertEq(qqq.balanceOf(alice) - aliceQqqBefore, qqqReward);

        vm.prank(alice);
        staking.withdraw(aliceId);
        assertEq(crtn.balanceOf(alice), 1_000 ether, "principal returned");
        assertEq(spy.balanceOf(pool), 10_000 ether - spyReward, "pool paid claim from EOA");
        assertEq(staking.reservedRewards(address(spy)), 600 ether - spyReward);
    }

    function testOnlyPositionOwnerCanClaimAndInvalidSignerIsRejected() public {
        vm.prank(alice);
        uint256 id = staking.stake(100 ether, 0, coreBundle);
        vm.prank(admin);
        staking.scheduleReward(coreBundle, address(spy), 100 ether, 30 days);
        vm.warp(block.timestamp + 30 days);
        uint256 amount = staking.earned(id, address(spy));
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = staking.rewardClaimDigest(id, alice, address(spy), amount, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(12345, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(bob);
        vm.expectRevert(CurtainStockStaking.NotPositionOwner.selector);
        staking.claimReward(id, address(spy), amount, deadline, signature);
        vm.prank(alice);
        vm.expectRevert(CurtainStockStaking.InvalidClaimSignature.selector);
        staking.claimReward(id, address(spy), amount, deadline, signature);
    }

    function testClaimCannotExceedAccruedOrBeReplayed() public {
        vm.prank(alice);
        uint256 id = staking.stake(100 ether, 0, coreBundle);
        vm.prank(admin);
        staking.scheduleReward(coreBundle, address(spy), 100 ether, 30 days);
        vm.warp(block.timestamp + 30 days);
        uint256 amount = staking.earned(id, address(spy));
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = staking.rewardClaimDigest(id, alice, address(spy), amount, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(POOL_KEY, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CurtainStockStaking.ClaimExceedsAccrued.selector, amount + 1, amount));
        staking.claimReward(id, address(spy), amount + 1, deadline, signature);
        vm.prank(alice);
        staking.claimReward(id, address(spy), amount, deadline, signature);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CurtainStockStaking.ClaimExceedsAccrued.selector, amount, 0));
        staking.claimReward(id, address(spy), amount, deadline, signature);
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
        assertTrue(staking.isRewardAsset(address(nvda)));

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

    function testScheduleRequiresWalletBalanceAndAllowance() public {
        vm.prank(admin);
        vm.expectRevert();
        staking.scheduleReward(coreBundle, address(nvda), 1 ether, 1 days);

        vm.prank(admin);
        vm.expectRevert();
        staking.scheduleReward(coreBundle, address(spy), 20_000 ether, 1 days);
    }

    function testRewardPoolCannotChangeAfterScheduleStarts() public {
        vm.prank(admin);
        staking.scheduleReward(coreBundle, address(spy), 100 ether, 30 days);
        vm.prank(admin);
        vm.expectRevert(CurtainStockStaking.RewardPoolAlreadyActive.selector);
        staking.setRewardPoolWallet(address(0x1234));
    }

    function testStreamsPauseWhenNoStakersAndResumeAfterStake() public {
        vm.prank(admin);
        staking.scheduleReward(coreBundle, address(spy), 100 ether, 10 days);
        vm.warp(block.timestamp + 30 days);
        vm.prank(alice);
        uint256 id = staking.stake(100 ether, 0, coreBundle);
        vm.warp(block.timestamp + 10 days);
        assertApproxEqRel(staking.earned(id, address(spy)), 100 ether, 1e12);
    }

    function testMaturedMultiplierCanBeKickedWithoutLosingAccruedRewards() public {
        vm.prank(alice);
        uint256 id = staking.stake(100 ether, 2, coreBundle);
        vm.prank(admin);
        staking.scheduleReward(coreBundle, address(spy), 100 ether, 180 days);
        vm.warp(block.timestamp + 180 days);
        uint256 earnedBefore = staking.earned(id, address(spy));
        staking.kick(id);
        assertApproxEqAbs(staking.earned(id, address(spy)), earnedBefore, 1e6);
    }
}
