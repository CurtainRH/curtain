// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { CurtainPoolV2 } from "../../src/pool/CurtainPoolV2.sol";
import { IPoolV2Verifier } from "../../src/pool/IPoolV2Verifier.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";
import { PoolV2Handler } from "./PoolV2Handler.sol";

contract PoolV2AlwaysValidVerifier is IPoolV2Verifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}

/// @notice Stateful solvency and accounting invariants for the fund-holding PoolV2 contract.
contract PoolV2Invariants is Test {
    CurtainPoolV2 public pool;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    PoolV2Handler public handler;

    function setUp() public {
        tokenA = new MockERC20("Token A", "TKA");
        tokenB = new MockERC20("Token B", "TKB");
        PoolV2AlwaysValidVerifier verifier = new PoolV2AlwaysValidVerifier();
        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);
        pool = new CurtainPoolV2(address(verifier), address(verifier), tokens, address(this), new address[](0));
        pool.appendRoot(bytes32(uint256(1)));
        handler = new PoolV2Handler(pool, tokenA, tokenB);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = PoolV2Handler.shield.selector;
        selectors[1] = PoolV2Handler.unshield.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
    }

    function invariant_tokenAAccountingIsSolvent() public view {
        assertGe(tokenA.balanceOf(address(pool)), pool.shieldedBalance(address(tokenA)));
    }

    function invariant_tokenBAccountingIsSolvent() public view {
        assertGe(tokenB.balanceOf(address(pool)), pool.shieldedBalance(address(tokenB)));
    }

    function invariant_tokenAAccountingMatchesCustody() public view {
        assertEq(tokenA.balanceOf(address(pool)), pool.shieldedBalance(address(tokenA)));
    }

    function invariant_tokenBAccountingMatchesCustody() public view {
        assertEq(tokenB.balanceOf(address(pool)), pool.shieldedBalance(address(tokenB)));
    }
}
