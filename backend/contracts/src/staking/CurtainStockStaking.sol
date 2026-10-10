// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Fixed-term CRTN staking with USDG-valued stock-bundle rewards paid from a pool EOA.
/// @dev APR is 4%; lock multipliers are 1x/1.5x/2x. Rewards stop at maturity. Prices and
///      payout token quantities are authorized by short-lived EIP-712 quotes from trusted signers.
contract CurtainStockStaking is Ownable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant BASE_APR_BPS = 400;
    uint256 public constant YEAR = 365 days;
    uint256 public constant MAX_BUNDLE_ASSETS = 16;
    address public constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    bytes32 private constant STAKE_QUOTE_TYPEHASH = keccak256(
        "StakeQuote(address account,uint256 amount,uint8 tierId,uint256 bundleId,uint256 principalUsd,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant REWARD_CLAIM_TYPEHASH = keccak256(
        "StockRewardClaim(uint256 positionId,address account,uint256 rewardUsd,bytes32 tokensHash,bytes32 amountsHash,uint256 nonce,uint256 deadline)"
    );

    struct Bundle { string name; bool exists; }
    struct Position {
        address owner;
        uint128 amount;
        uint128 principalUsd; // USDG base units, signed by the operator at entry.
        uint128 claimedUsd;
        uint64 stakedAt;
        uint64 unlockAt;
        uint32 bundleId;
        uint8 tierId;
        bool principalWithdrawn;
    }

    IERC20 public immutable stakeToken;
    address public immutable rewardPoolWallet;
    uint256 public bundleCount;
    uint256 public positionCount;
    uint256 public totalStaked;
    mapping(address => bool) public isRewardAsset;
    address[] private rewardAssets;
    mapping(uint256 => Bundle) private bundles;
    mapping(uint256 => address[]) private bundleAssets;
    mapping(uint256 => uint16[]) private bundleWeights;
    mapping(uint256 => Position) public positions;
    mapping(address => uint256) public stakeQuoteNonces;
    mapping(uint256 => uint256) public claimNonces;

    event RewardAssetAdded(address indexed token);
    event BundleAdded(uint256 indexed bundleId, string name, address[] assets, uint16[] weightsBps);
    event Staked(uint256 indexed positionId, address indexed owner, uint256 indexed bundleId, uint256 amount, uint8 tierId, uint64 unlockAt, uint256 principalUsd);
    event PrincipalWithdrawn(uint256 indexed positionId, address indexed owner, uint256 amount);
    event StockRewardsClaimed(uint256 indexed positionId, address indexed owner, uint256 rewardUsd);

    error ZeroAddress();
    error ZeroAmount();
    error BadTier(uint8 tierId);
    error InvalidBundle();
    error InvalidAsset(address token);
    error InvalidWeights();
    error DuplicateAsset(address token);
    error NotPositionOwner();
    error PositionLocked(uint64 unlockAt);
    error PositionAlreadyWithdrawn();
    error InvalidQuoteSignature();
    error QuoteExpired();
    error QuoteAmountMismatch();
    error NothingToClaim();
    error InvalidClaimPackage();
    error PoolUnavailable(address token, uint256 needed, uint256 balance, uint256 allowance);
    error FeeOnTransferUnsupported(address token, uint256 expected, uint256 received);
    error ValueTooLarge();

    constructor(address admin, address crtn, address poolWallet) Ownable(admin) EIP712("CurtainStockStaking", "2") {
        if (admin == address(0) || crtn == address(0) || poolWallet == address(0)) revert ZeroAddress();
        if (crtn.code.length == 0) revert InvalidAsset(crtn);
        if (poolWallet.code.length != 0) revert InvalidAsset(poolWallet);
        stakeToken = IERC20(crtn);
        rewardPoolWallet = poolWallet;
    }

    function tier(uint8 tierId) public pure returns (uint64 lockSeconds, uint16 multiplierBps) {
        if (tierId == 0) return (30 days, 10_000);
        if (tierId == 1) return (90 days, 15_000);
        if (tierId == 2) return (180 days, 20_000);
        revert BadTier(tierId);
    }

    function addRewardAsset(address token) external onlyOwner {
        if (token == address(0) || token == address(stakeToken) || token == USDG || token.code.length == 0) revert InvalidAsset(token);
        if (isRewardAsset[token]) revert DuplicateAsset(token);
        isRewardAsset[token] = true;
        rewardAssets.push(token);
        emit RewardAssetAdded(token);
    }

    function rewardAssetCount() external view returns (uint256) { return rewardAssets.length; }
    function rewardAssetAt(uint256 index) external view returns (address) { return rewardAssets[index]; }

    function addBundle(string calldata name, address[] calldata assets, uint16[] calldata weightsBps)
        external onlyOwner returns (uint256 bundleId)
    {
        if (bytes(name).length == 0 || assets.length == 0 || assets.length > MAX_BUNDLE_ASSETS || assets.length != weightsBps.length) revert InvalidBundle();
        uint256 sum;
        for (uint256 i; i < assets.length; ++i) {
            address asset = assets[i];
            if (asset == address(0) || asset == address(stakeToken) || asset == USDG || asset.code.length == 0) revert InvalidAsset(asset);
            if (weightsBps[i] == 0) revert InvalidWeights();
            sum += weightsBps[i];
            for (uint256 j; j < i; ++j) if (assets[j] == asset) revert DuplicateAsset(asset);
        }
        if (sum != BPS || bundleCount >= type(uint32).max) revert InvalidWeights();
        bundleId = ++bundleCount;
        bundles[bundleId] = Bundle(name, true);
        for (uint256 i; i < assets.length; ++i) {
            if (!isRewardAsset[assets[i]]) {
                isRewardAsset[assets[i]] = true;
                rewardAssets.push(assets[i]);
                emit RewardAssetAdded(assets[i]);
            }
            bundleAssets[bundleId].push(assets[i]);
            bundleWeights[bundleId].push(weightsBps[i]);
        }
        emit BundleAdded(bundleId, name, assets, weightsBps);
    }

    function getBundle(uint256 bundleId) external view returns (string memory name, address[] memory assets, uint16[] memory weightsBps) {
        if (!bundles[bundleId].exists) revert InvalidBundle();
        name = bundles[bundleId].name;
        assets = bundleAssets[bundleId];
        weightsBps = bundleWeights[bundleId];
    }

    function stake(uint256 amount, uint8 tierId, uint256 bundleId, uint256 principalUsd, uint256 quoteDeadline, bytes calldata quoteSignature)
        external nonReentrant returns (uint256 positionId)
    {
        if (amount == 0 || principalUsd == 0) revert ZeroAmount();
        if (amount > type(uint128).max || principalUsd > type(uint128).max || bundleId > type(uint32).max) revert ValueTooLarge();
        if (!bundles[bundleId].exists) revert InvalidBundle();
        (uint64 lockSeconds,) = tier(tierId);
        if (block.timestamp > quoteDeadline) revert QuoteExpired();
        uint256 nonce = stakeQuoteNonces[msg.sender];
        bytes32 structHash = keccak256(abi.encode(STAKE_QUOTE_TYPEHASH, msg.sender, amount, tierId, bundleId, principalUsd, nonce, quoteDeadline));
        if (ECDSA.recover(_hashTypedDataV4(structHash), quoteSignature) != owner()) revert InvalidQuoteSignature();
        stakeQuoteNonces[msg.sender] = nonce + 1;

        uint256 beforeBalance = stakeToken.balanceOf(address(this));
        stakeToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = stakeToken.balanceOf(address(this)) - beforeBalance;
        if (received != amount) revert FeeOnTransferUnsupported(address(stakeToken), amount, received);

        positionId = ++positionCount;
        uint64 now64 = uint64(block.timestamp);
        uint64 unlockAt = now64 + lockSeconds;
        positions[positionId] = Position({
            owner: msg.sender,
            amount: uint128(amount),
            principalUsd: uint128(principalUsd),
            claimedUsd: 0,
            stakedAt: now64,
            unlockAt: unlockAt,
            bundleId: uint32(bundleId),
            tierId: tierId,
            principalWithdrawn: false
        });
        totalStaked += amount;
        emit Staked(positionId, msg.sender, bundleId, amount, tierId, unlockAt, principalUsd);
    }

    /// @notice USDG-valued simple APR accrues linearly only until the fixed unlock timestamp.
    function earnedUsd(uint256 positionId) public view returns (uint256) {
        Position storage p = positions[positionId];
        if (p.owner == address(0)) return 0;
        (, uint16 multiplierBps) = tier(p.tierId);
        uint256 accrualEnd = block.timestamp < p.unlockAt ? block.timestamp : p.unlockAt;
        uint256 elapsed = accrualEnd - uint256(p.stakedAt);
        uint256 gross = uint256(p.principalUsd) * BASE_APR_BPS * multiplierBps * elapsed / (BPS * BPS * YEAR);
        return gross > p.claimedUsd ? gross - p.claimedUsd : 0;
    }

    function withdraw(uint256 positionId) external nonReentrant {
        Position storage p = positions[positionId];
        if (p.owner != msg.sender) revert NotPositionOwner();
        if (p.principalWithdrawn) revert PositionAlreadyWithdrawn();
        if (block.timestamp < p.unlockAt) revert PositionLocked(p.unlockAt);
        p.principalWithdrawn = true;
        totalStaked -= p.amount;
        stakeToken.safeTransfer(msg.sender, p.amount);
        emit PrincipalWithdrawn(positionId, msg.sender, p.amount);
    }

    /// @notice Atomically pays the complete USDG-valued accrued reward as the selected stock bundle.
    /// @dev A pool shortage reverts all transfers and preserves the user's full accrued entitlement.
    function claimStockRewards(uint256 positionId, uint256 rewardUsd, address[] calldata tokens, uint256[] calldata amounts, uint256 deadline, bytes calldata signature)
        external nonReentrant
    {
        Position storage p = positions[positionId];
        if (p.owner != msg.sender) revert NotPositionOwner();
        if (block.timestamp < p.unlockAt) revert PositionLocked(p.unlockAt);
        if (block.timestamp > deadline) revert QuoteExpired();
        uint256 claimable = earnedUsd(positionId);
        if (claimable == 0) revert NothingToClaim();
        address[] storage assets = bundleAssets[p.bundleId];
        if (rewardUsd != claimable || rewardUsd > type(uint128).max || tokens.length != assets.length || amounts.length != assets.length) revert InvalidClaimPackage();
        for (uint256 i; i < assets.length; ++i) if (tokens[i] != assets[i] || amounts[i] == 0) revert InvalidClaimPackage();

        uint256 nonce = claimNonces[positionId];
        bytes32 structHash = keccak256(abi.encode(
            REWARD_CLAIM_TYPEHASH, positionId, msg.sender, rewardUsd, keccak256(abi.encode(tokens)), keccak256(abi.encode(amounts)), nonce, deadline
        ));
        if (ECDSA.recover(_hashTypedDataV4(structHash), signature) != rewardPoolWallet) revert InvalidQuoteSignature();
        claimNonces[positionId] = nonce + 1;
        p.claimedUsd += uint128(rewardUsd);

        for (uint256 i; i < assets.length; ++i) {
            IERC20 token = IERC20(tokens[i]);
            uint256 balance = token.balanceOf(rewardPoolWallet);
            uint256 approved = token.allowance(rewardPoolWallet, address(this));
            if (balance < amounts[i] || approved < amounts[i]) revert PoolUnavailable(tokens[i], amounts[i], balance, approved);
            uint256 beforeBalance = token.balanceOf(msg.sender);
            token.safeTransferFrom(rewardPoolWallet, msg.sender, amounts[i]);
            uint256 received = token.balanceOf(msg.sender) - beforeBalance;
            if (received != amounts[i]) revert FeeOnTransferUnsupported(tokens[i], amounts[i], received);
        }
        emit StockRewardsClaimed(positionId, msg.sender, rewardUsd);
    }
}
