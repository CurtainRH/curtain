// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {CurtainPoolV2} from "../src/pool/CurtainPoolV2.sol";
import {PoolV2RootManager} from "../src/pool/PoolV2RootManager.sol";
import {PoolV2TransferVerifierAdapter} from "../src/pool/PoolV2TransferVerifierAdapter.sol";
import {PoolV2UnshieldVerifierAdapter} from "../src/pool/PoolV2UnshieldVerifierAdapter.sol";
import {PoolV2TransferGroth16VerifierV2} from "../src/pool/generated/PoolV2TransferGroth16VerifierV2.sol";
import {PoolV2UnshieldGroth16VerifierV2} from "../src/pool/generated/PoolV2UnshieldGroth16VerifierV2.sol";

/// @notice Deploys Curtain Pool V2 for the product-level V4 route.
///
/// Required environment:
///   PRIVATE_KEY                         deployment wallet
///   POOL_V2_ROOT_MANAGER_OWNER          final owner/admin of the root manager (optional: deployer)
///   POOL_V2_ROOT_PUBLISHER              root publishing service (optional: deployer)
///   POOL_V2_TOKEN_ADDRS                  comma-separated ERC-20 addresses
///   POOL_V2_SWAP_TARGETS                 comma-separated allowlisted swap adapters/routers
///
contract DeployPoolV2Script is Script {
    uint256 internal constant RHC_CHAIN_ID = 4663;

    error MissingVerifier();
    error MissingRootManager();
    error MissingTokens();
    error InvalidTokenList();

    function run() external returns (PoolV2TransferVerifierAdapter adapter, PoolV2UnshieldVerifierAdapter unshieldAdapter, PoolV2RootManager manager, CurtainPoolV2 pool) {
        string memory rawTokens = vm.envString("POOL_V2_TOKEN_ADDRS");
        string memory rawSwapTargets = vm.envOr("POOL_V2_SWAP_TARGETS", string(""));
        uint256 key = vm.envUint("PRIVATE_KEY");

        address[] memory tokens = _parseAddresses(rawTokens);
        address[] memory swapTargets = _parseOptionalAddresses(rawSwapTargets);
        if (tokens.length == 0) revert MissingTokens();

        address deployer = vm.addr(key);
        address rootOwner = vm.envOr("POOL_V2_ROOT_MANAGER_OWNER", deployer);
        address rootPublisher = vm.envOr("POOL_V2_ROOT_PUBLISHER", deployer);
        if (rootOwner == address(0) || rootPublisher == address(0)) revert MissingRootManager();
        console.log("Deployer:             ", deployer);
        console.log("Root manager owner:   ", rootOwner);
        console.log("Root publisher:       ", rootPublisher);
        console.log("Token count:          ", tokens.length);
        if (block.chainid == RHC_CHAIN_ID) console.log("Network:              Robinhood Chain");

        vm.startBroadcast(key);
        PoolV2TransferGroth16VerifierV2 generatedTransfer = new PoolV2TransferGroth16VerifierV2();
        PoolV2UnshieldGroth16VerifierV2 generatedUnshield = new PoolV2UnshieldGroth16VerifierV2();
        adapter = new PoolV2TransferVerifierAdapter(address(generatedTransfer));
        unshieldAdapter = new PoolV2UnshieldVerifierAdapter(address(generatedUnshield));
        // The deployer is the temporary root-manager owner so it can initialize the pool.
        manager = new PoolV2RootManager(deployer, rootPublisher);
        pool = new CurtainPoolV2(address(adapter), address(unshieldAdapter), tokens, address(manager), swapTargets);
        manager.setPool(address(pool));
        if (rootOwner != deployer) manager.transferOwnership(rootOwner);
        vm.stopBroadcast();

        console.log("Pool V2:              ", address(pool));
        console.log("Pool V2 verifier:     ", address(adapter));
        console.log("Pool V2 unshield:     ", address(unshieldAdapter));
        console.log("Pool V2 root manager: ", address(manager));
    }

    function _parseAddresses(string memory raw) internal pure returns (address[] memory result) {
        bytes memory data = bytes(raw);
        uint256 count;
        for (uint256 i; i < data.length; ++i) if (data[i] == ",") ++count;
        result = new address[](data.length == 0 ? 0 : count + 1);
        uint256 start;
        uint256 index;
        for (uint256 i; i <= data.length; ++i) {
            if (i != data.length && data[i] != ",") continue;
            if (i == start) revert InvalidTokenList();
            address token = vm.parseAddress(_slice(data, start, i));
            if (token == address(0)) revert InvalidTokenList();
            result[index++] = token;
            start = i + 1;
        }
    }

    function _parseOptionalAddresses(string memory raw) internal pure returns (address[] memory) {
        if (bytes(raw).length == 0) return new address[](0);
        return _parseAddresses(raw);
    }

    function _slice(bytes memory data, uint256 start, uint256 end) private pure returns (string memory) {
        bytes memory out = new bytes(end - start);
        for (uint256 i; i < out.length; ++i) out[i] = data[start + i];
        return string(out);
    }
}
