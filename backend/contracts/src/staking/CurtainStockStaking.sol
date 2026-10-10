// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice CRTN staking with stock-token bundle rewards and a non-withdrawable reward treasury.
/// @dev Reward assets and bundle definitions are append-only. Funding is permissionless and
///      streams each constituent independently; configured weights describe the target mix,
///      not a price-oracle-enforced market-value allocation.
contract CurtainStockStaking is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant PRECISION = 1e18;
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_BUNDLE_ASSETS = 16;
    address public constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

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
    event RewardFunded(
        uint256 indexed bundleId, address indexed token, address indexed funder, uint256 amount, uint256 duration
    );
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

    constructor(address admin, address crtn) Ownable(admin) {
        if (admin == address(0) || crtn == address(0)) revert ZeroAddress();
        if (crtn.code.length == 0) revert InvalidAsset(crtn);
        stakeToken = IERC20(crtn);
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

    /// @notice Anyone may fund an approved bundle constituent; no admin funding privilege is needed.
    /// @dev Funding is an ERC-20 pull. Direct transfers do not create a reward schedule.
    function fundReward(uint256 bundleId, address token, uint256 amount, uint256 duration) external nonReentrant {
        if (!bundles[bundleId].exists || bundleWeightBps[bundleId][token] == 0) revert InvalidBundle();
        if (amount == 0) revert ZeroAmount();
        if (duration == 0) revert ZeroDuration();

        RewardStream storage stream = rewardStreams[bundleId][token];
        _updateStream(bundleId, token);

        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - beforeBalance;
        if (received != amount) revert FeeOnTransferUnsupported(token, amount, received);

        uint256 remaining =
            block.timestamp < stream.periodFinish ? (stream.periodFinish - block.timestamp) * stream.rate : 0;
        stream.rate = (amount + remaining) / duration;
        if (stream.rate == 0) revert EmissionTooSmall();
        stream.lastUpdate = block.timestamp;
        stream.periodFinish = block.timestamp + duration;
        reservedRewards[token] += amount;
        emit RewardFunded(bundleId, token, msg.sender, amount, duration);
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

    /// @notice Return principal and all accrued bundle constituents after the selected lock expires.
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
        address[] storage assets = bundleAssets[bundleId];
        for (uint256 i; i < assets.length; ++i) {
            address asset = assets[i];
            uint256 reward = pendingRewards[positionId][asset];
            pendingRewards[positionId][asset] = 0;
            if (reward != 0) {
                reservedRewards[asset] -= reward;
                uint256 recipientBefore = IERC20(asset).balanceOf(msg.sender);
                IERC20(asset).safeTransfer(msg.sender, reward);
                uint256 recipientReceived = IERC20(asset).balanceOf(msg.sender) - recipientBefore;
                if (recipientReceived != reward) {
                    revert FeeOnTransferUnsupported(asset, reward, recipientReceived);
                }
                emit RewardPaid(positionId, msg.sender, asset, reward);
            }
        }
        emit Withdrawn(positionId, msg.sender, p.amount);
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
