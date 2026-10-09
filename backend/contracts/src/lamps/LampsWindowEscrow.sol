// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Reference escrow for integrators building fixed-window compute bookings with Lamps.
/// @dev No owner, admin key, oracle, or unilateral dispute resolver. Disputes need both parties'
///      EIP-712 signatures. A dispute without mutual agreement remains escrowed indefinitely.
contract LampsWindowEscrow is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    bytes32 private constant RESOLUTION_TYPEHASH = keccak256(
        "DisputeResolution(bytes32 bookingId,uint256 buyerRefund,uint256 buyerStakeRefund,uint256 hostBondToBuyer)"
    );

    enum State { None, AwaitingHostBond, Funded, Started, Delivered, Disputed, Settled, Refunded }
    struct Booking {
        address buyer;
        address host;
        IERC20 token;
        uint128 price;
        uint128 hostBond;
        uint128 buyerStake;
        uint64 windowStart;
        uint64 windowEnd;
        uint64 deliveredAt;
        State state;
    }

    uint16 public immutable hostBondBps;
    uint16 public immutable buyerDisputeStakeBps;
    uint32 public immutable reviewWindow;
    uint32 public immutable noShowGrace;
    mapping(bytes32 => Booking) public bookings;

    event BookingFunded(bytes32 indexed bookingId, address indexed buyer, address indexed host, address token, uint256 price, uint256 hostBond, uint64 windowStart, uint64 windowEnd);
    event HostBondPosted(bytes32 indexed bookingId, uint256 amount);
    event WorkStarted(bytes32 indexed bookingId);
    event WorkDelivered(bytes32 indexed bookingId, uint64 deliveredAt);
    event BuyerDisputed(bytes32 indexed bookingId, uint256 stakeAmount);
    event DisputeResolved(bytes32 indexed bookingId, uint256 buyerRefund, uint256 buyerStakeRefund, uint256 hostBondToBuyer);
    event BookingReleased(bytes32 indexed bookingId);
    event NoShowRefunded(bytes32 indexed bookingId);

    error InvalidBooking();
    error WrongParty();
    error WrongState();
    error OutsideWindow();
    error InvalidTerms();
    error InvalidAgreement();
    error TooEarly();

    constructor(uint16 hostBondBps_, uint16 buyerDisputeStakeBps_, uint32 reviewWindow_, uint32 noShowGrace_)
        EIP712("LampsWindowEscrow", "1")
    {
        if (hostBondBps_ > BPS || buyerDisputeStakeBps_ > BPS || reviewWindow_ == 0 || noShowGrace_ == 0)
            revert InvalidTerms();
        hostBondBps = hostBondBps_;
        buyerDisputeStakeBps = buyerDisputeStakeBps_;
        reviewWindow = reviewWindow_;
        noShowGrace = noShowGrace_;
    }

    /// @notice Buyer creates a booking and escrows the full price.
    function createBooking(bytes32 bookingId, address host, IERC20 token, uint128 price, uint64 windowStart, uint64 windowEnd)
        external nonReentrant
    {
        if (bookingId == bytes32(0) || host == address(0) || address(token) == address(0) || price == 0 ||
            host == msg.sender || windowStart <= block.timestamp || windowEnd <= windowStart || bookings[bookingId].state != State.None) revert InvalidBooking();
        uint256 bond = (uint256(price) * hostBondBps) / BPS;
        if (bond > type(uint128).max) revert InvalidTerms();
        token.safeTransferFrom(msg.sender, address(this), price);
        State initialState = bond == 0 ? State.Funded : State.AwaitingHostBond;
        bookings[bookingId] = Booking({
            buyer: msg.sender, host: host, token: token, price: price, hostBond: uint128(bond), buyerStake: 0,
            windowStart: windowStart, windowEnd: windowEnd, deliveredAt: 0, state: initialState
        });
        emit BookingFunded(bookingId, msg.sender, host, address(token), price, bond, windowStart, windowEnd);
    }

    function postHostBond(bytes32 bookingId) external nonReentrant {
        Booking storage b = bookings[bookingId];
        if (b.host != msg.sender) revert WrongParty();
        if (b.state != State.AwaitingHostBond) revert WrongState();
        b.token.safeTransferFrom(msg.sender, address(this), b.hostBond);
        b.state = State.Funded;
        emit HostBondPosted(bookingId, b.hostBond);
    }

    function markStarted(bytes32 bookingId) external {
        Booking storage b = bookings[bookingId];
        if (b.host != msg.sender) revert WrongParty();
        if (b.state != State.Funded) revert WrongState();
        if (block.timestamp < b.windowStart || block.timestamp >= b.windowEnd) revert OutsideWindow();
        b.state = State.Started;
        emit WorkStarted(bookingId);
    }

    function markDelivered(bytes32 bookingId) external {
        Booking storage b = bookings[bookingId];
        if (b.host != msg.sender) revert WrongParty();
        if (b.state != State.Started || block.timestamp > b.windowEnd) revert WrongState();
        b.state = State.Delivered;
        b.deliveredAt = uint64(block.timestamp);
        emit WorkDelivered(bookingId, b.deliveredAt);
    }

    function release(bytes32 bookingId) external nonReentrant {
        Booking storage b = bookings[bookingId];
        if (b.buyer != msg.sender) revert WrongParty();
        if (b.state != State.Delivered) revert WrongState();
        _release(bookingId, b);
    }

    /// @notice If buyer does not respond during the review window, anyone can complete payout.
    function finalizeAfterReview(bytes32 bookingId) external nonReentrant {
        Booking storage b = bookings[bookingId];
        if (b.state != State.Delivered) revert WrongState();
        if (block.timestamp <= uint256(b.deliveredAt) + reviewWindow) revert TooEarly();
        _release(bookingId, b);
    }

    function dispute(bytes32 bookingId) external nonReentrant {
        Booking storage b = bookings[bookingId];
        if (b.buyer != msg.sender) revert WrongParty();
        bool inReview = b.state == State.Delivered && block.timestamp <= uint256(b.deliveredAt) + reviewWindow;
        bool startedButNotDelivered = b.state == State.Started && block.timestamp > b.windowEnd;
        if (!inReview && !startedButNotDelivered) revert WrongState();
        uint256 stake = (uint256(b.price) * buyerDisputeStakeBps) / BPS;
        if (stake != 0) b.token.safeTransferFrom(msg.sender, address(this), stake);
        if (stake > type(uint128).max) revert InvalidTerms();
        b.buyerStake = uint128(stake);
        b.state = State.Disputed;
        emit BuyerDisputed(bookingId, stake);
    }

    /// @notice Either party may submit the exact settlement only with both parties' typed signatures.
    function resolveByMutualAgreement(
        bytes32 bookingId, uint128 buyerRefund, uint128 buyerStakeRefund, uint128 hostBondToBuyer,
        bytes calldata buyerSignature, bytes calldata hostSignature
    ) external nonReentrant {
        Booking storage b = bookings[bookingId];
        if (b.state != State.Disputed) revert WrongState();
        if (buyerRefund > b.price || buyerStakeRefund > b.buyerStake || hostBondToBuyer > b.hostBond) revert InvalidTerms();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            RESOLUTION_TYPEHASH, bookingId, buyerRefund, buyerStakeRefund, hostBondToBuyer
        )));
        if (ECDSA.recover(digest, buyerSignature) != b.buyer || ECDSA.recover(digest, hostSignature) != b.host)
            revert InvalidAgreement();
        b.state = State.Settled;
        uint256 toBuyer = uint256(buyerRefund) + buyerStakeRefund + hostBondToBuyer;
        uint256 toHost = uint256(b.price) - buyerRefund + b.hostBond - hostBondToBuyer + b.buyerStake - buyerStakeRefund;
        if (toBuyer != 0) b.token.safeTransfer(b.buyer, toBuyer);
        if (toHost != 0) b.token.safeTransfer(b.host, toHost);
        emit DisputeResolved(bookingId, buyerRefund, buyerStakeRefund, hostBondToBuyer);
    }

    function resolutionDigest(bytes32 bookingId, uint128 buyerRefund, uint128 buyerStakeRefund, uint128 hostBondToBuyer)
        external view returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(
            RESOLUTION_TYPEHASH, bookingId, buyerRefund, buyerStakeRefund, hostBondToBuyer
        )));
    }

    /// @notice Buyer receives price plus host bond if work never started by the end/grace boundary.
    function refundNoShow(bytes32 bookingId) external nonReentrant {
        Booking storage b = bookings[bookingId];
        if (b.state != State.Funded && b.state != State.AwaitingHostBond) revert WrongState();
        if (block.timestamp <= uint256(b.windowEnd) + noShowGrace) revert TooEarly();
        uint256 refund = uint256(b.price) + (b.state == State.Funded ? b.hostBond : 0);
        b.state = State.Refunded;
        b.token.safeTransfer(b.buyer, refund);
        emit NoShowRefunded(bookingId);
    }

    function _release(bytes32 bookingId, Booking storage b) private {
        b.state = State.Settled;
        b.token.safeTransfer(b.host, uint256(b.price) + b.hostBond);
        emit BookingReleased(bookingId);
    }

}
