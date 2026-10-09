// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @notice Exact-input swaps through a Uniswap v4 pool, shaped like a router CurtainVault can
/// use: the vault approves this contract for `amountIn` and calls `swapExactIn`. The adapter
/// pulls the input, swaps inside `PoolManager.unlock`, sends the output straight to
/// `recipient`, and returns any input the pool didn't take. It holds no funds between calls
/// and has no owner.
///
/// Only ERC-20 pools are supported (no native ETH). The caller picks the pool key; the vault
/// enforces the minimum output and that the output actually landed. Pools with hooks run that
/// hook's code during the swap, so the operator should only route through pools it has vetted.
contract UniswapV4Adapter is IUnlockCallback {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;

    struct SwapData {
        PoolKey key;
        bool zeroForOne;
        uint256 amount;
        uint256 limit;
        address payer;
        address recipient;
        bool exactOutput;
    }

    error NotPoolManager();
    error NativeNotSupported();
    error InsufficientOutput(uint256 amountOut, uint256 minOut);
    error AmountTooLarge();
    error ExcessiveInput(uint256 amountIn, uint256 maxIn);

    constructor(address poolManager_) {
        poolManager = IPoolManager(poolManager_);
    }

    /// @notice Swaps exactly `amountIn` of the input currency (currency0 if `zeroForOne`) for at
    /// least `minOut` of the other, sent to `recipient`. Unspent input is returned to the caller.
    function swapExactIn(PoolKey calldata key, bool zeroForOne, uint256 amountIn, uint256 minOut, address recipient)
        external
        returns (uint256 amountOut)
    {
        if (Currency.unwrap(key.currency0) == address(0)) revert NativeNotSupported();
        if (amountIn > uint256(uint128(type(int128).max))) revert AmountTooLarge();
        address tokenIn = Currency.unwrap(zeroForOne ? key.currency0 : key.currency1);
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        amountOut = abi.decode(
            poolManager.unlock(abi.encode(SwapData(key, zeroForOne, amountIn, minOut, msg.sender, recipient, false))), (uint256)
        );

        uint256 leftover = IERC20(tokenIn).balanceOf(address(this));
        if (leftover > 0) IERC20(tokenIn).safeTransfer(msg.sender, leftover);
    }

    /// @notice Swaps for exactly `amountOut`, spending no more than `maxIn`.
    /// @dev Unused input is returned to the caller, which lets Curtain bind a note to the
    /// exact output amount before the swap transaction is submitted.
    function swapExactOut(PoolKey calldata key, bool zeroForOne, uint256 amountOut, uint256 maxIn, address recipient)
        external
        returns (uint256 amountIn)
    {
        if (Currency.unwrap(key.currency0) == address(0)) revert NativeNotSupported();
        if (amountOut > uint256(uint128(type(int128).max))) revert AmountTooLarge();
        address tokenIn = Currency.unwrap(zeroForOne ? key.currency0 : key.currency1);
        uint256 beforeIn = IERC20(tokenIn).balanceOf(address(this));
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), maxIn);

        poolManager.unlock(abi.encode(SwapData(key, zeroForOne, amountOut, maxIn, msg.sender, recipient, true)));

        uint256 afterIn = IERC20(tokenIn).balanceOf(address(this));
        uint256 unspent = afterIn - beforeIn;
        if (unspent > 0) IERC20(tokenIn).safeTransfer(msg.sender, unspent);
        amountIn = maxIn - unspent;
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        SwapData memory d = abi.decode(raw, (SwapData));

        BalanceDelta delta = poolManager.swap(
            d.key,
            IPoolManager.SwapParams({
                zeroForOne: d.zeroForOne,
                amountSpecified: d.exactOutput ? int256(d.amount) : -int256(d.amount), // positive = exact output
                sqrtPriceLimitX96: d.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        // From our side of the pool: the input delta is negative (we owe), the output positive.
        (int128 inDelta, int128 outDelta) = d.zeroForOne ? (delta.amount0(), delta.amount1()) : (delta.amount1(), delta.amount0());
        uint256 owed = uint256(uint128(-inDelta));
        uint256 amountOut = uint256(uint128(outDelta));
        if (d.exactOutput) {
            if (owed > d.limit) revert ExcessiveInput(owed, d.limit);
        } else if (amountOut < d.limit) {
            revert InsufficientOutput(amountOut, d.limit);
        }

        Currency currencyIn = d.zeroForOne ? d.key.currency0 : d.key.currency1;
        Currency currencyOut = d.zeroForOne ? d.key.currency1 : d.key.currency0;

        poolManager.sync(currencyIn);
        IERC20(Currency.unwrap(currencyIn)).safeTransfer(address(poolManager), owed);
        poolManager.settle();
        poolManager.take(currencyOut, d.recipient, amountOut);

        return abi.encode(amountOut);
    }
}
