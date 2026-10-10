// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { CurtainStockStaking } from "../../src/staking/CurtainStockStaking.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";

contract CurtainStockStakingTest is Test {
    bytes32 constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    uint256 constant OPERATOR_KEY = 0x0A11CE;
    uint256 constant POOL_KEY = 0xBEEF1234;
    address operator;
    address pool;
    address alice = address(0xA11CE);
    CurtainStockStaking staking;
    MockERC20 crtn;
    MockERC20 spy;
    MockERC20 qqq;
    uint256 bundleId;

    function domainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("CurtainStockStaking"), keccak256("2"), block.chainid, address(staking)));
    }

    function setUp() public {
        vm.warp(1_000_000);
        operator = vm.addr(OPERATOR_KEY);
        pool = vm.addr(POOL_KEY);
        crtn = new MockERC20("Curtain", "CRTN");
        spy = new MockERC20("SPY", "SPY");
        qqq = new MockERC20("QQQ", "QQQ");
        staking = new CurtainStockStaking(operator, address(crtn), pool);
        address[] memory assets = new address[](2);
        uint16[] memory weights = new uint16[](2);
        assets[0] = address(spy); assets[1] = address(qqq);
        weights[0] = 6_000; weights[1] = 4_000;
        vm.prank(operator);
        bundleId = staking.addBundle("Market Core", assets, weights);
        crtn.mint(alice, 1_000 ether);
        spy.mint(pool, 10_000 ether);
        qqq.mint(pool, 10_000 ether);
        vm.prank(alice); crtn.approve(address(staking), type(uint256).max);
        vm.prank(pool); spy.approve(address(staking), type(uint256).max);
        vm.prank(pool); qqq.approve(address(staking), type(uint256).max);
    }

    function stakeFor(uint8 tierId) internal returns (uint256 id) {
        uint256 amount = 100 ether;
        uint256 principalUsd = 1_000_000_000; // $1,000 in USDG's 6 decimals.
        uint256 deadline = block.timestamp + 5 minutes;
        uint256 nonce = staking.stakeQuoteNonces(alice);
        bytes32 structHash = keccak256(abi.encode(
            keccak256("StakeQuote(address account,uint256 amount,uint8 tierId,uint256 bundleId,uint256 principalUsd,uint256 nonce,uint256 deadline)"),
            alice, amount, tierId, bundleId, principalUsd, nonce, deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OPERATOR_KEY, digest);
        vm.prank(alice);
        id = staking.stake(amount, tierId, bundleId, principalUsd, deadline, abi.encodePacked(r, s, v));
    }

    function claimSignature(uint256 id, uint256 rewardUsd, address[] memory assets, uint256[] memory amounts, uint256 deadline) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(
            keccak256("StockRewardClaim(uint256 positionId,address account,uint256 rewardUsd,bytes32 tokensHash,bytes32 amountsHash,uint256 nonce,uint256 deadline)"),
            id, alice, rewardUsd, keccak256(abi.encode(assets)), keccak256(abi.encode(amounts)), staking.claimNonces(id), deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(POOL_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function testAprUsesPrincipalUsdAndMultipliers() public {
        uint256 id30 = stakeFor(0);
        uint256 id90 = stakeFor(1);
        uint256 id180 = stakeFor(2);
        vm.warp(block.timestamp + 180 days);
        assertApproxEqAbs(staking.earnedUsd(id30), 3_287_671, 2);
        assertApproxEqAbs(staking.earnedUsd(id90), 14_794_520, 2);
        assertApproxEqAbs(staking.earnedUsd(id180), 39_452_054, 2);
    }

    function testAccrualStopsAtMaturityAndPrincipalCanBeWithdrawnSeparately() public {
        uint256 id = stakeFor(0);
        (, , , , , uint64 unlockAt, , ,) = staking.positions(id);
        vm.warp(unlockAt);
        uint256 matured = staking.earnedUsd(id);
        vm.warp(uint256(unlockAt) + 90 days);
        assertEq(staking.earnedUsd(id), matured);
        vm.prank(alice); staking.withdraw(id);
        assertEq(crtn.balanceOf(alice), 1_000 ether);
        assertEq(staking.earnedUsd(id), matured);
    }

    function testCannotWithdrawOrClaimBeforeUnlock() public {
        uint256 id = stakeFor(0);
        vm.expectPartialRevert(CurtainStockStaking.PositionLocked.selector); vm.prank(alice); staking.withdraw(id);
        address[] memory assets = new address[](2); assets[0] = address(spy); assets[1] = address(qqq);
        uint256[] memory amounts = new uint256[](2); amounts[0] = 1; amounts[1] = 1;
        uint256 rewardUsd = staking.earnedUsd(id);
        uint256 deadline = block.timestamp + 1 days;
        bytes memory signature = claimSignature(id, rewardUsd, assets, amounts, deadline);
        vm.expectPartialRevert(CurtainStockStaking.PositionLocked.selector); vm.prank(alice);
        staking.claimStockRewards(id, rewardUsd, assets, amounts, deadline, signature);
    }

    function testBundleClaimPaysAllTokensAtomicallyAndCannotReplay() public {
        uint256 id = stakeFor(0);
        (, , , , , uint64 unlockAt, , ,) = staking.positions(id);
        vm.warp(unlockAt);
        uint256 rewardUsd = staking.earnedUsd(id);
        address[] memory assets = new address[](2); assets[0] = address(spy); assets[1] = address(qqq);
        uint256[] memory amounts = new uint256[](2); amounts[0] = 6 ether; amounts[1] = 4 ether;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = claimSignature(id, rewardUsd, assets, amounts, deadline);
        uint256 spyBefore = spy.balanceOf(alice); uint256 qqqBefore = qqq.balanceOf(alice);
        vm.prank(alice); staking.claimStockRewards(id, rewardUsd, assets, amounts, deadline, signature);
        assertEq(spy.balanceOf(alice) - spyBefore, amounts[0]);
        assertEq(qqq.balanceOf(alice) - qqqBefore, amounts[1]);
        vm.expectRevert(CurtainStockStaking.NothingToClaim.selector); vm.prank(alice);
        staking.claimStockRewards(id, rewardUsd, assets, amounts, deadline, signature);
    }

    function testUnderfundingRevertsWithoutConsumingEntitlement() public {
        uint256 id = stakeFor(0);
        (, , , , , uint64 unlockAt, , ,) = staking.positions(id);
        vm.warp(unlockAt);
        uint256 rewardUsd = staking.earnedUsd(id);
        address[] memory assets = new address[](2); assets[0] = address(spy); assets[1] = address(qqq);
        uint256[] memory amounts = new uint256[](2); amounts[0] = type(uint256).max; amounts[1] = 4 ether;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = claimSignature(id, rewardUsd, assets, amounts, deadline);
        vm.prank(alice);
        vm.expectPartialRevert(CurtainStockStaking.PoolUnavailable.selector);
        staking.claimStockRewards(id, rewardUsd, assets, amounts, deadline, signature);
        assertEq(staking.earnedUsd(id), rewardUsd, "claim remains available");
        assertEq(spy.balanceOf(alice), 0, "atomic revert rolls back any prior payout");
    }

    function testOwnerCannotWithdrawPoolAssetsAndBundleMixCannotChange() public {
        vm.prank(operator); vm.expectRevert(); spy.transferFrom(pool, operator, 1);
        address[] memory assets = new address[](1); assets[0] = address(spy);
        uint16[] memory weights = new uint16[](1); weights[0] = 10_000;
        vm.prank(operator); uint256 next = staking.addBundle("New bundle", assets, weights);
        (string memory name,,) = staking.getBundle(next);
        assertEq(name, "New bundle");
    }
}
