// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { CurtainPoolV2 } from "../../src/pool/CurtainPoolV2.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";

/// @notice Stateful randomized shield/unshield actions for PoolV2 accounting invariants.
contract PoolV2Handler is Test {
    CurtainPoolV2 public immutable pool;
    MockERC20 public immutable tokenA;
    MockERC20 public immutable tokenB;

    uint256 public nextCommitment = 1;
    uint256 public nextNullifier = 1;

    constructor(CurtainPoolV2 pool_, MockERC20 tokenA_, MockERC20 tokenB_) {
        pool = pool_;
        tokenA = tokenA_;
        tokenB = tokenB_;
        tokenA_.approve(address(pool_), type(uint256).max);
        tokenB_.approve(address(pool_), type(uint256).max);
    }

    function shield(uint256 tokenSeed, uint256 amountSeed) external {
        MockERC20 token = tokenSeed % 2 == 0 ? tokenA : tokenB;
        uint256 amount = bound(amountSeed, 1, 1_000_000 ether);
        token.mint(address(this), amount);
        pool.shield(address(token), amount, bytes32(nextCommitment++));
    }

    function unshield(uint256 tokenSeed, uint256 amountSeed) external {
        MockERC20 token = tokenSeed % 2 == 0 ? tokenA : tokenB;
        uint256 available = pool.shieldedBalance(address(token));
        if (available == 0) return;
        uint256 amount = bound(amountSeed, 1, available);
        pool.unshield(
            hex"",
            pool.currentRoot(),
            bytes32(nextNullifier++),
            address(token),
            amount,
            address(this)
        );
    }
}
