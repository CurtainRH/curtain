// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {LampsWindowEscrow} from "../../src/lamps/LampsWindowEscrow.sol";

contract LampsWindowEscrowTest is Test {
    uint256 private buyerKey = 0xB0B;
    uint256 private hostKey = 0xA057;
    address private buyer;
    address private host;
    MockERC20 private token;
    LampsWindowEscrow private escrow;
    bytes32 private constant BOOKING = keccak256("window-1");

    function setUp() public {
        buyer = vm.addr(buyerKey);
        host = vm.addr(hostKey);
        token = new MockERC20("Test", "TST");
        escrow = new LampsWindowEscrow(2_000, 500, 1 days, 1 hours);
        token.mint(buyer, 10_000 ether);
        token.mint(host, 10_000 ether);
        vm.prank(buyer);
        token.approve(address(escrow), type(uint256).max);
        vm.prank(host);
        token.approve(address(escrow), type(uint256).max);
    }

    function testFundsAndReleasesAfterBuyerConfirmation() public {
        _createAndBond();
        vm.warp(block.timestamp + 1 hours);
        vm.prank(host);
        escrow.markStarted(BOOKING);
        vm.prank(host);
        escrow.markDelivered(BOOKING);
        uint256 hostBefore = token.balanceOf(host);
        vm.prank(buyer);
        escrow.release(BOOKING);
        assertEq(token.balanceOf(host), hostBefore + 120 ether);
        assertEq(uint8(_state()), uint8(LampsWindowEscrow.State.Settled));
    }

    function testNoShowRefundReturnsBuyerPriceAndSlashesPostedHostBond() public {
        _createAndBond();
        (, , , , , , , uint64 windowEnd, , ) = escrow.bookings(BOOKING);
        uint256 buyerBefore = token.balanceOf(buyer);
        vm.warp(uint256(windowEnd) + 1 hours + 1);
        escrow.refundNoShow(BOOKING);
        assertEq(token.balanceOf(buyer), buyerBefore + 120 ether);
        assertEq(uint8(_state()), uint8(LampsWindowEscrow.State.Refunded));
    }

    function testDisputeRequiresBothPartiesAndDistributesAgreedTerms() public {
        _createAndBond();
        vm.warp(block.timestamp + 1 hours);
        vm.prank(host);
        escrow.markStarted(BOOKING);
        vm.prank(host);
        escrow.markDelivered(BOOKING);
        vm.prank(buyer);
        escrow.dispute(BOOKING);
        uint128 buyerRefund = 80 ether;
        uint128 stakeRefund = 5 ether;
        uint128 bondToBuyer = 20 ether;
        bytes32 digest = escrow.resolutionDigest(BOOKING, buyerRefund, stakeRefund, bondToBuyer);
        bytes memory buyerSig = _sign(buyerKey, digest);
        bytes memory hostSig = _sign(hostKey, digest);
        uint256 buyerBefore = token.balanceOf(buyer);
        uint256 hostBefore = token.balanceOf(host);
        escrow.resolveByMutualAgreement(BOOKING, buyerRefund, stakeRefund, bondToBuyer, buyerSig, hostSig);
        assertEq(token.balanceOf(buyer), buyerBefore + 105 ether);
        assertEq(token.balanceOf(host), hostBefore + 20 ether);
    }

    function testOnePartyCannotResolveDispute() public {
        _createAndBond();
        vm.warp(block.timestamp + 1 hours);
        vm.prank(host);
        escrow.markStarted(BOOKING);
        vm.prank(host);
        escrow.markDelivered(BOOKING);
        vm.prank(buyer);
        escrow.dispute(BOOKING);
        bytes32 digest = escrow.resolutionDigest(BOOKING, 0, 0, 0);
        bytes memory buyerSig = _sign(buyerKey, digest);
        vm.expectRevert(LampsWindowEscrow.InvalidAgreement.selector);
        escrow.resolveByMutualAgreement(BOOKING, 0, 0, 0, buyerSig, buyerSig);
    }

    function _createAndBond() private {
        uint64 start = uint64(block.timestamp + 1 hours);
        uint64 end = start + 2 hours;
        vm.prank(buyer);
        escrow.createBooking(BOOKING, host, token, 100 ether, start, end);
        vm.prank(host);
        escrow.postHostBond(BOOKING);
    }

    function _state() private view returns (LampsWindowEscrow.State state) {
        (,,,,,,,,,state) = escrow.bookings(BOOKING);
    }

    function _sign(uint256 key, bytes32 digest) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
