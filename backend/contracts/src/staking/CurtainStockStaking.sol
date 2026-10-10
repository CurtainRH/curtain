// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice CRTN staking with stock rewards held in an EOA pool wallet.
/// @dev The owner schedules rewards backed by wallet balance and allowance. Users claim with
///      backend-signed vouchers and submit the transfer transaction themselves, paying gas.
contract CurtainStockStaking is Ownable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    uint256 public constant PRECISION = 1e18;
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_BUNDLE_ASSETS = 16;
    address public constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    bytes32 private constant CLAIM_TYPEHASH = keccak256(
        "RewardClaim(uint256 positionId,address account,address token,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    struct Bundle {
        string name;
        bool exists;
    }

    struct RewardStream {
        uint256 rate;
        uint256 periodFinish;
        uint256 lastUpdate;
        uint256 rewardPerWeightStored;
    }

    struct Position {
        address owner;
        uint128 amount;
        uint128 weighted;
        uint64 unlockAt;
        uint32 bundleId;
        bool closed;
    }

    IERC20 public immutable stakeToken;
    address public rewardPoolWallet;
    bool public rewardScheduleStarted;
    uint256 public bundleCount;
    uint256 public positionCount;
    uint256 public totalStaked;

    mapping(address => bool) public isRewardAsset;
    address[] private rewardAssets;
    mapping(uint256 => Bundle) private bundles;
    mapping(uint256 => address[]) private bundleAssets;
    mapping(uint256 => mapping(address => uint16)) public bundleWeightBps;
    mapping(uint256 => uint256) public totalWeightedByBundle;
    mapping(uint256 => mapping(address => RewardStream)) public rewardStreams;
    mapping(address => uint256) public reservedRewards;
    mapping(uint256 => Position) public positions;
    mapping(uint256 => mapping(address => uint256)) public rewardPerWeightPaid;
    mapping(uint256 => mapping(address => uint256)) public pendingRewards;
    mapping(uint256 => mapping(address => uint256)) public claimNonces;

    event RewardAssetAdded(address indexed token);
    event BundleAdded(uint256 indexed bundleId, string name, address[] assets, uint16[] weightsBps);
    event Staked(
        uint256 indexed positionId,
        address indexed owner,
        uint256 indexed bundleId,
        uint256 amount,
        uint8 tier,
        uint64 unlockAt
    );
    event RewardPoolWalletSet(address indexed wallet);
    event RewardScheduled(uint256 indexed bundleId, address indexed token, uint256 amount, uint256 duration);
    event PositionKicked(uint256 indexed positionId, uint256 newWeight);
    event Withdrawn(uint256 indexed positionId, address indexed owner, uint256 principal);
    event RewardPaid(uint256 indexed positionId, address indexed owner, address indexed token, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error BadTier(uint8 tier);
    error InvalidBundle();
    error InvalidAsset(address token);
    error InvalidWeights();
    error DuplicateAsset(address token);
    error ZeroDuration();
    error EmissionTooSmall();
    error NotPositionOwner();
    error PositionClosed();
    error PositionLocked(uint64 unlockAt);
    error NotKickable();
    error FeeOnTransferUnsupported(address token, uint256 expected, uint256 received);
    error AmountTooLarge();
    error RewardPoolNotConfigured();
    error RewardPoolAlreadyActive();
    error InsufficientPoolBacking(address token, uint256 required, uint256 balance, uint256 allowance);
    error InvalidClaimSignature();
    error ClaimExpired();
    error NothingToClaim();
    error ClaimExceedsAccrued(uint256 requested, uint256 accrued);

    constructor(address admin, address crtn) Ownable(admin) EIP712("CurtainStockStaking", "1") {
        if (admin == address(0) || crtn == address(0)) revert ZeroAddress();
        if (crtn.code.length == 0) revert InvalidAsset(crtn);
        stakeToken = IERC20(crtn);
    }

    /// @notice Set or correct the pool EOA before any reward schedule has started.
    function setRewardPoolWallet(address wallet) external onlyOwner {
        if (wallet == address(0) || wallet.code.length != 0) revert ZeroAddress();
        if (rewardScheduleStarted) revert RewardPoolAlreadyActive();
        rewardPoolWallet = wallet;
        emit RewardPoolWalletSet(wallet);
    }

    function tier(uint8 t) public pure returns (uint64 lockSeconds, uint16 multiplierBps) {
        if (t == 0) return (30 days, 10_000);
        if (t == 1) return (90 days, 15_000);
        if (t == 2) return (180 days, 20_000);
        revert BadTier(t);
    }

    /// @notice Add a stock-token reward asset. This is append-only; the owner cannot remove it.
    function addRewardAsset(address token) external onlyOwner {
        if (token == address(0) || token == address(stakeToken) || token == USDG || token.code.length == 0) {
            revert InvalidAsset(token);
        }
        if (isRewardAsset[token]) revert DuplicateAsset(token);
        isRewardAsset[token] = true;
        rewardAssets.push(token);
        emit RewardAssetAdded(token);
    }

    function rewardAssetCount() external view returns (uint256) {
        return rewardAssets.length;
    }

    function rewardAssetAt(uint256 index) external view returns (address) {
        return rewardAssets[index];
    }

    /// @notice Append a new immutable bundle. Existing bundle IDs can never be edited/deleted.
    function addBundle(string calldata name, address[] calldata assets, uint16[] calldata weightsBps)
        external
        onlyOwner
        returns (uint256 bundleId)
    {
        if (
            bytes(name).length == 0 || assets.length == 0 || assets.length > MAX_BUNDLE_ASSETS
                || assets.length != weightsBps.length
        ) {
            revert InvalidBundle();
        }
        uint256 sum;
        for (uint256 i; i < assets.length; ++i) {
            address asset = assets[i];
            if (asset == address(0) || asset == address(stakeToken) || asset == USDG || asset.code.length == 0) {
                revert InvalidAsset(asset);
            }
            if (weightsBps[i] == 0) revert InvalidWeights();
            sum += weightsBps[i];
            for (uint256 j; j < i; ++j) {
                if (assets[j] == asset) revert DuplicateAsset(asset);
            }
        }
        if (sum != BPS) revert InvalidWeights();
        if (bundleCount >= type(uint32).max) revert InvalidBundle();

        bundleId = ++bundleCount;
        bundles[bundleId] = Bundle({ name: name, exists: true });
        for (uint256 i; i < assets.length; ++i) {
            if (!isRewardAsset[assets[i]]) {
                isRewardAsset[assets[i]] = true;
                rewardAssets.push(assets[i]);
                emit RewardAssetAdded(assets[i]);
            }
            bundleAssets[bundleId].push(assets[i]);
            bundleWeightBps[bundleId][assets[i]] = weightsBps[i];
        }
        emit BundleAdded(bundleId, name, assets, weightsBps);
    }

    function getBundle(uint256 bundleId)
        external
        view
        returns (string memory name, address[] memory assets, uint16[] memory weightsBps)
    {
        if (!bundles[bundleId].exists) revert InvalidBundle();
        name = bundles[bundleId].name;
        assets = bundleAssets[bundleId];
        weightsBps = new uint16[](assets.length);
        for (uint256 i; i < assets.length; ++i) {
            weightsBps[i] = bundleWeightBps[bundleId][assets[i]];
        }
    }

    /// @notice Schedule rewards already held in the pool wallet, after its approval to this contract.
    function scheduleReward(uint256 bundleId, address token, uint256 amount, uint256 duration)
        external
        onlyOwner
        nonReentrant
    {
        if (!bundles[bundleId].exists || bundleWeightBps[bundleId][token] == 0) revert InvalidBundle();
        if (amount == 0) revert ZeroAmount();
        if (duration == 0) revert ZeroDuration();
        address pool = rewardPoolWallet;
        if (pool == address(0)) revert RewardPoolNotConfigured();

        RewardStream storage stream = rewardStreams[bundleId][token];
        _updateStream(bundleId, token);
        uint256 remaining =
            block.timestamp < stream.periodFinish ? (stream.periodFinish - block.timestamp) * stream.rate : 0;
        uint256 required = reservedRewards[token] + amount;
        uint256 poolBalance = IERC20(token).balanceOf(pool);
        uint256 poolAllowance = IERC20(token).allowance(pool, address(this));
        if (poolBalance < required || poolAllowance < required) {
            revert InsufficientPoolBacking(token, required, poolBalance, poolAllowance);
        }
        stream.rate = (amount + remaining) / duration;
        if (stream.rate == 0) revert EmissionTooSmall();
        stream.lastUpdate = block.timestamp;
        stream.periodFinish = block.timestamp + duration;
        reservedRewards[token] += amount;
        rewardScheduleStarted = true;
        emit RewardScheduled(bundleId, token, amount, duration);
    }

    function stake(uint256 amount, uint8 tierId, uint256 bundleId) external nonReentrant returns (uint256 positionId) {
        if (amount == 0) revert ZeroAmount();
        if (!bundles[bundleId].exists) revert InvalidBundle();
        if (amount > type(uint128).max) revert AmountTooLarge();
        (uint64 lockSeconds, uint16 multiplierBps) = tier(tierId);
        uint256 weighted = (amount * multiplierBps) / BPS;
        if (weighted > type(uint128).max) revert AmountTooLarge();

        _updateBundle(bundleId);
        uint256 stakeBalanceBefore = stakeToken.balanceOf(address(this));
        stakeToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 stakeReceived = stakeToken.balanceOf(address(this)) - stakeBalanceBefore;
        if (stakeReceived != amount) revert FeeOnTransferUnsupported(address(stakeToken), amount, stakeReceived);

        positionId = ++positionCount;
        uint64 unlockAt = uint64(block.timestamp) + lockSeconds;
        positions[positionId] = Position({
            owner: msg.sender,
            amount: uint128(amount),
            weighted: uint128(weighted),
            unlockAt: unlockAt,
            bundleId: uint32(bundleId),
            closed: false
        });
        totalStaked += amount;
        totalWeightedByBundle[bundleId] += weighted;

        address[] storage assets = bundleAssets[bundleId];
        for (uint256 i; i < assets.length; ++i) {
            address asset = assets[i];
            rewardPerWeightPaid[positionId][asset] = rewardStreams[bundleId][asset].rewardPerWeightStored;
        }
        emit Staked(positionId, msg.sender, bundleId, amount, tierId, unlockAt);
    }

    /// @notice Matured positions lose their term multiplier; anyone can trigger this checkpoint.
    function kick(uint256 positionId) external nonReentrant {
        Position storage p = positions[positionId];
        if (p.owner == address(0) || p.closed || block.timestamp < p.unlockAt || p.weighted <= p.amount) {
            revert NotKickable();
        }
        uint256 bundleId = p.bundleId;
        _updateBundle(bundleId);
        _checkpoint(positionId, p);
        totalWeightedByBundle[bundleId] = totalWeightedByBundle[bundleId] - p.weighted + p.amount;
        p.weighted = p.amount;
        emit PositionKicked(positionId, p.amount);
    }

    function earned(uint256 positionId, address token) public view returns (uint256) {
        Position storage p = positions[positionId];
        if (p.owner == address(0) || !isRewardAsset[token] || bundleWeightBps[p.bundleId][token] == 0) return 0;
        if (p.closed) return pendingRewards[positionId][token];
        RewardStream storage stream = rewardStreams[p.bundleId][token];
        uint256 accumulator = stream.rewardPerWeightStored;
        uint256 totalWeight = totalWeightedByBundle[p.bundleId];
        uint256 applicable = block.timestamp < stream.periodFinish ? block.timestamp : stream.periodFinish;
        if (totalWeight != 0 && applicable > stream.lastUpdate) {
            accumulator += ((applicable - stream.lastUpdate) * stream.rate * PRECISION) / totalWeight;
        }
        return pendingRewards[positionId][token]
            + (uint256(p.weighted) * (accumulator - rewardPerWeightPaid[positionId][token])) / PRECISION;
    }

    /// @notice Return principal after lock expiry; stock rewards are claimed separately.
    function withdraw(uint256 positionId) external nonReentrant {
        Position storage p = positions[positionId];
        if (p.owner != msg.sender) revert NotPositionOwner();
        if (p.closed) revert PositionClosed();
        if (block.timestamp < p.unlockAt) revert PositionLocked(p.unlockAt);

        uint256 bundleId = p.bundleId;
        _updateBundle(bundleId);
        _checkpoint(positionId, p);
        p.closed = true;
        totalStaked -= p.amount;
        totalWeightedByBundle[bundleId] -= p.weighted;

        stakeToken.safeTransfer(msg.sender, p.amount);
        emit Withdrawn(positionId, msg.sender, p.amount);
    }

    /// @notice Claim a backend-authorized reward from the EOA pool; the user submits and pays gas.
    function claimReward(
        uint256 positionId,
        address token,
        uint256 amount,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant {
        Position storage p = positions[positionId];
        if (p.owner != msg.sender) revert NotPositionOwner();
        if (block.timestamp < p.unlockAt) revert PositionLocked(p.unlockAt);
        if (!isRewardAsset[token] || bundleWeightBps[p.bundleId][token] == 0) revert InvalidAsset(token);
        if (block.timestamp > deadline) revert ClaimExpired();
        if (amount == 0) revert NothingToClaim();

        uint256 bundleId = p.bundleId;
        _updateBundle(bundleId);
        if (!p.closed) _checkpoint(positionId, p);
        uint256 accrued = pendingRewards[positionId][token];
        if (amount > accrued) revert ClaimExceedsAccrued(amount, accrued);

        uint256 nonce = claimNonces[positionId][token];
        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH, positionId, msg.sender, token, amount, nonce, deadline));
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (signer != rewardPoolWallet || signer == address(0)) revert InvalidClaimSignature();

        claimNonces[positionId][token] = nonce + 1;
        pendingRewards[positionId][token] = accrued - amount;
        reservedRewards[token] -= amount;
        uint256 recipientBefore = IERC20(token).balanceOf(msg.sender);
        IERC20(token).safeTransferFrom(rewardPoolWallet, msg.sender, amount);
        uint256 received = IERC20(token).balanceOf(msg.sender) - recipientBefore;
        if (received != amount) revert FeeOnTransferUnsupported(token, amount, received);
        emit RewardPaid(positionId, msg.sender, token, amount);
    }

    /// @notice Digest helper for the backend claim signer and client-side verification.
    function rewardClaimDigest(
        uint256 positionId,
        address account,
        address token,
        uint256 amount,
        uint256 deadline
    ) external view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(CLAIM_TYPEHASH, positionId, account, token, amount, claimNonces[positionId][token], deadline)
        );
        return _hashTypedDataV4(structHash);
    }

    function bundleAssetCount(uint256 bundleId) external view returns (uint256) {
        if (!bundles[bundleId].exists) revert InvalidBundle();
        return bundleAssets[bundleId].length;
    }

    function _updateBundle(uint256 bundleId) internal {
        address[] storage assets = bundleAssets[bundleId];
        for (uint256 i; i < assets.length; ++i) {
            _updateStream(bundleId, assets[i]);
        }
    }

    function _updateStream(uint256 bundleId, address token) internal {
        RewardStream storage stream = rewardStreams[bundleId][token];
        uint256 totalWeight = totalWeightedByBundle[bundleId];
        if (totalWeight == 0) {
            if (
                stream.lastUpdate != 0 && stream.lastUpdate < stream.periodFinish && block.timestamp > stream.lastUpdate
            ) {
                stream.periodFinish += block.timestamp - stream.lastUpdate;
            }
            stream.lastUpdate = block.timestamp;
            return;
        }
        uint256 applicable = block.timestamp < stream.periodFinish ? block.timestamp : stream.periodFinish;
        if (applicable > stream.lastUpdate) {
            stream.rewardPerWeightStored += ((applicable - stream.lastUpdate) * stream.rate * PRECISION) / totalWeight;
            stream.lastUpdate = applicable;
        }
    }

    function _checkpoint(uint256 positionId, Position storage p) internal {
        address[] storage assets = bundleAssets[p.bundleId];
        for (uint256 i; i < assets.length; ++i) {
            address asset = assets[i];
            RewardStream storage stream = rewardStreams[p.bundleId][asset];
            pendingRewards[
                    positionId
                ][
                    asset
                ] += (uint256(p.weighted) * (stream.rewardPerWeightStored - rewardPerWeightPaid[positionId][asset]))
                / PRECISION;
            rewardPerWeightPaid[positionId][asset] = stream.rewardPerWeightStored;
        }
    }
}
