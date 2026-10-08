// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Curtain V3 vault. V2 remains the flexible-amount compatibility vault.
/// V3 accepts only admin-approved denominations and commits the payout tag in the
/// deposit preimage. A refund reserves that tag, so a later settlement cannot race it.
contract CurtainVaultV3 is Ownable2Step, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    uint64 public constant REFUND_DELAY = 3 minutes;
    uint64 public constant REFUND_FINALIZATION_DELAY = 1 hours;
    uint16 public constant MAX_FEE_BPS = 100;
    uint16 public constant MAX_KEEPER_FEE_BPS = 100;
    uint256 private constant BPS = 10_000;
    bytes32 public constant SETTLEMENT_TYPEHASH =
        keccak256("Settlement(bytes32 swapHash,bytes32 payoutsHash,uint256 deadline,uint256 nonce)");

    enum Status {
        None,
        Active,
        RefundRequested,
        Settled,
        Refunded
    }

    struct Deposit {
        address depositor;
        address token;
        uint256 amount;
        bytes32 deadlineHash;
        uint64 refundRequestedAt;
        Status status;
    }

    struct Swap {
        address router;
        address tokenIn;
        uint256 amountIn;
        address tokenOut;
        uint256 minOut;
        bytes data;
    }

    struct Payout {
        address recipient;
        uint256 amount;
        uint256 protocolFee;
        uint256 keeperFee;
        bytes32 tag;
    }

    address public operator;
    address public treasury;
    uint16 public feeBps = 20;
    bool public depositsPaused;
    uint256 public depositCount;
    mapping(address => bool) public allowedToken;
    mapping(address => bool) public allowedRouter;
    mapping(address => mapping(uint256 => bool)) public allowedAmount;
    mapping(uint256 => Deposit) public deposits;
    mapping(address => mapping(bytes32 => bool)) public deadlineHashUsed;
    mapping(uint256 => bool) public nonceUsed;
    mapping(bytes32 => bool) public tagUsed;
    mapping(bytes32 => bool) public refundReservedTag;

    event Deposited(
        uint256 indexed depositId,
        address indexed depositor,
        address indexed token,
        uint256 amount,
        bytes32 deadlineHash
    );
    event Settled(
        uint256 indexed nonce,
        address indexed tokenIn,
        uint256 amountIn,
        address indexed tokenOut,
        uint256 amountOut,
        uint256 paid,
        address keeper
    );
    event PaidOut(
        bytes32 indexed tag,
        address indexed recipient,
        address indexed token,
        uint256 amount,
        uint256 protocolFee,
        uint256 keeperFee,
        address keeper
    );
    event RefundRequested(uint256 indexed depositId, uint256 deadline, bytes32 indexed tag);
    event Refunded(uint256 indexed depositId, address indexed depositor, address indexed token, uint256 amount);
    event TokenAllowed(address indexed token, bool allowed);
    event RouterAllowed(address indexed router, bool allowed);
    event AmountAllowed(address indexed token, uint256 amount, bool allowed);
    event DepositsPaused(bool paused);
    event OperatorSet(address operator);
    event TreasurySet(address treasury);
    event FeeSet(uint16 feeBps);

    error ZeroAddress();
    error TokenNotAllowed(address token);
    error RouterNotAllowed(address router);
    error AmountNotAllowed(address token, uint256 amount);
    error ZeroAmount();
    error DeadlineHashReused();
    error DepositsArePaused();
    error BadSignature();
    error SettlementExpired();
    error NonceUsed();
    error TagUsed();
    error RefundReserved();
    error BadRecipient(address recipient);
    error FeeAboveCap();
    error PaysMoreThanSwapped(uint256 paid, uint256 output);
    error NoPayouts();
    error NotSwap();
    error SwapCallFailed();
    error InputMismatch(uint256 spent, uint256 expected);
    error InsufficientOutput(uint256 got, uint256 min);
    error WrongStatus(Status status);
    error NotDepositor();
    error WrongDeadline();
    error TooEarly(uint256 availableAt);
    error FeeTooHigh();
    error AlreadyPaid();

    constructor(
        address admin,
        address operator_,
        address treasury_,
        address[] memory tokens,
        uint256[] memory amounts,
        address[] memory routers
    ) Ownable(admin) EIP712("CurtainVault", "1") {
        if (operator_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        operator = operator_;
        treasury = treasury_;
        emit OperatorSet(operator_);
        emit TreasurySet(treasury_);
        if (tokens.length != amounts.length) revert AmountNotAllowed(address(0), 0);
        for (uint256 i; i < tokens.length; ++i) {
            allowedToken[tokens[i]] = true;
            allowedAmount[tokens[i]][amounts[i]] = true;
            emit TokenAllowed(tokens[i], true);
            emit AmountAllowed(tokens[i], amounts[i], true);
        }
        for (uint256 i; i < routers.length; ++i) {
            if (routers[i] != address(0)) {
                allowedRouter[routers[i]] = true;
                emit RouterAllowed(routers[i], true);
            }
        }
    }

    function setOperator(address value) external onlyOwner {
        if (value == address(0)) revert ZeroAddress();
        operator = value;
        emit OperatorSet(value);
    }

    function setTreasury(address value) external onlyOwner {
        if (value == address(0)) revert ZeroAddress();
        treasury = value;
        emit TreasurySet(value);
    }

    function setFeeBps(uint16 value) external onlyOwner {
        if (value > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = value;
        emit FeeSet(value);
    }

    function setAllowedToken(address token, bool value) external onlyOwner {
        allowedToken[token] = value;
        emit TokenAllowed(token, value);
    }

    function setAllowedRouter(address router, bool value) external onlyOwner {
        allowedRouter[router] = value;
        emit RouterAllowed(router, value);
    }

    function setAllowedAmount(address token, uint256 amount, bool value) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        allowedAmount[token][amount] = value;
        emit AmountAllowed(token, amount, value);
    }

    function setDepositsPaused(bool value) external onlyOwner {
        depositsPaused = value;
        emit DepositsPaused(value);
    }

    function deposit(address token, uint256 amount, bytes32 deadlineHash) external nonReentrant returns (uint256 id) {
        if (depositsPaused) revert DepositsArePaused();
        if (!allowedToken[token]) revert TokenNotAllowed(token);
        if (!allowedAmount[token][amount]) revert AmountNotAllowed(token, amount);
        if (deadlineHashUsed[msg.sender][deadlineHash]) revert DeadlineHashReused();
        deadlineHashUsed[msg.sender][deadlineHash] = true;
        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - beforeBalance;
        if (received != amount) revert AmountNotAllowed(token, received);
        id = ++depositCount;
        deposits[id] = Deposit(msg.sender, token, received, deadlineHash, 0, Status.Active);
        emit Deposited(id, msg.sender, token, received, deadlineHash);
    }

    function hashSwap(Swap calldata s) public pure returns (bytes32) {
        return keccak256(abi.encode(s.router, s.tokenIn, s.amountIn, s.tokenOut, s.minOut, keccak256(s.data)));
    }

    function hashPayouts(Payout[] calldata p) public pure returns (bytes32) {
        return keccak256(abi.encode(p));
    }

    function settlementDigest(Swap calldata s, Payout[] calldata p, uint256 deadline, uint256 nonce)
        public
        view
        returns (bytes32)
    {
        return
            _hashTypedDataV4(keccak256(abi.encode(SETTLEMENT_TYPEHASH, hashSwap(s), hashPayouts(p), deadline, nonce)));
    }

    function settle(
        Swap calldata s,
        Payout[] calldata payouts,
        uint256 deadline,
        uint256 nonce,
        bytes calldata signature
    ) external nonReentrant {
        if (block.timestamp > deadline) revert SettlementExpired();
        if (nonceUsed[nonce]) revert NonceUsed();
        if (payouts.length == 0) revert NoPayouts();
        if (ECDSA.recover(settlementDigest(s, payouts, deadline, nonce), signature) != operator) revert BadSignature();
        nonceUsed[nonce] = true;
        uint256 output = _swap(s);
        uint256 paid = 0;
        uint256 protocol = 0;
        uint256 keeper = 0;
        IERC20 token = IERC20(s.tokenOut);
        for (uint256 i; i < payouts.length; ++i) {
            Payout calldata p = payouts[i];
            if (p.recipient == address(0) || p.recipient == address(this)) revert BadRecipient(p.recipient);
            if (tagUsed[p.tag]) revert TagUsed();
            if (refundReservedTag[p.tag]) revert RefundReserved();
            tagUsed[p.tag] = true;
            uint256 gross = p.amount + p.protocolFee + p.keeperFee;
            if (p.protocolFee * BPS > gross * feeBps || p.keeperFee * BPS > gross * MAX_KEEPER_FEE_BPS) {
                revert FeeAboveCap();
            }
            paid += gross;
            protocol += p.protocolFee;
            keeper += p.keeperFee;
        }
        if (paid > output) revert PaysMoreThanSwapped(paid, output);
        for (uint256 i; i < payouts.length; ++i) {
            Payout calldata p = payouts[i];
            if (p.amount > 0) token.safeTransfer(p.recipient, p.amount);
            if (p.protocolFee > 0) token.safeTransfer(treasury, p.protocolFee);
            if (p.keeperFee > 0) token.safeTransfer(msg.sender, p.keeperFee);
            emit PaidOut(p.tag, p.recipient, s.tokenOut, p.amount, p.protocolFee, p.keeperFee, msg.sender);
        }
        uint256 surplus = output - paid;
        if (surplus > 0) token.safeTransfer(treasury, surplus);
        emit Settled(nonce, s.tokenIn, s.amountIn, s.tokenOut, output, paid, msg.sender);
    }

    function _swap(Swap calldata s) internal returns (uint256 output) {
        if (!allowedToken[s.tokenIn]) revert TokenNotAllowed(s.tokenIn);
        if (!allowedToken[s.tokenOut]) revert TokenNotAllowed(s.tokenOut);
        if (s.tokenIn == s.tokenOut) {
            if (s.router != address(0) || s.data.length != 0) revert NotSwap();
            return s.amountIn;
        }
        if (!allowedRouter[s.router]) revert RouterNotAllowed(s.router);
        IERC20 input = IERC20(s.tokenIn);
        uint256 beforeIn = input.balanceOf(address(this));
        uint256 beforeOut = IERC20(s.tokenOut).balanceOf(address(this));
        input.forceApprove(s.router, s.amountIn);
        (bool ok,) = s.router.call(s.data);
        if (!ok) revert SwapCallFailed();
        input.forceApprove(s.router, 0);
        uint256 spent = beforeIn - input.balanceOf(address(this));
        if (spent > s.amountIn) revert InputMismatch(spent, s.amountIn);
        output = IERC20(s.tokenOut).balanceOf(address(this)) - beforeOut;
        if (output < s.minOut) revert InsufficientOutput(output, s.minOut);
    }

    /// @notice V3 commits (deadline, salt, tag) in the deposit hash. The tag is keccak(secret).
    function requestRefund(uint256 id, uint256 deadline, bytes32 salt, bytes32 tag) external {
        Deposit storage d = deposits[id];
        if (msg.sender != d.depositor) revert NotDepositor();
        if (d.status != Status.Active) revert WrongStatus(d.status);
        if (keccak256(abi.encode(deadline, salt, tag)) != d.deadlineHash) revert WrongDeadline();
        if (tagUsed[tag]) revert AlreadyPaid();
        if (refundReservedTag[tag]) revert RefundReserved();
        if (block.timestamp < deadline + REFUND_DELAY) revert TooEarly(deadline + REFUND_DELAY);
        refundReservedTag[tag] = true;
        d.status = Status.RefundRequested;
        d.refundRequestedAt = uint64(block.timestamp);
        emit RefundRequested(id, deadline, tag);
    }

    function finalizeRefund(uint256 id) external {
        finalizeRefundTo(id, address(0));
    }

    function finalizeRefundTo(uint256 id, address recipient) public nonReentrant {
        Deposit storage d = deposits[id];
        if (d.status != Status.RefundRequested) revert WrongStatus(d.status);
        uint256 availableAt = uint256(d.refundRequestedAt) + REFUND_FINALIZATION_DELAY;
        if (block.timestamp <= availableAt) revert TooEarly(availableAt + 1);
        d.status = Status.Refunded;
        address to = recipient != address(0) && msg.sender == d.depositor ? recipient : d.depositor;
        IERC20(d.token).safeTransfer(to, d.amount);
        emit Refunded(id, to, d.token, d.amount);
    }
}
