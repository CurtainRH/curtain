// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {CurtainPoolV2} from "../src/pool/CurtainPoolV2.sol";
import {PoolV2RootManager} from "../src/pool/PoolV2RootManager.sol";
import {UniswapV4Adapter} from "../src/adapters/UniswapV4Adapter.sol";

/// @notice Deploys a swap-ready Pool V2 using the already-reviewed production proof adapters.
/// @dev Deploys a fresh immutable pool/root manager and a V4 DEX adapter with exact-output
/// support. The legacy pool remains deployed and must remain indexed for note recovery.
/// Required environment: PRIVATE_KEY, POOL_V2_VERIFIER_ADAPTER,
/// POOL_V2_UNSHIELD_VERIFIER_ADAPTER, POOL_V2_TOKEN_ADDRS,
/// DEX_ROUTER_ADDR (Uniswap V3 SwapRouter02), V4_POOL_MANAGER_ADDR.
contract DeployPoolV2SwapReadyScript is Script {
    uint256 internal constant RHC_CHAIN_ID = 4663;

    error WrongChain();
    error BadDeploymentInput();

    function run() external returns (UniswapV4Adapter dexAdapter, PoolV2RootManager manager, CurtainPoolV2 pool) {
        if (block.chainid != RHC_CHAIN_ID) revert WrongChain();
        uint256 key = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(key);
        address verifier = vm.envAddress("POOL_V2_VERIFIER_ADAPTER");
        address unshieldVerifier = vm.envAddress("POOL_V2_UNSHIELD_VERIFIER_ADAPTER");
        address router = vm.envAddress("DEX_ROUTER_ADDR");
        address poolManager = vm.envAddress("V4_POOL_MANAGER_ADDR");
        address[] memory tokens = _parseAddresses(vm.envString("POOL_V2_TOKEN_ADDRS"));
        if (verifier.code.length == 0 || unshieldVerifier.code.length == 0 || router.code.length == 0 || poolManager.code.length == 0 || tokens.length == 0) {
            revert BadDeploymentInput();
        }
        console.log("Deployer:                  ", deployer);
        console.log("Existing transfer verifier:", verifier);
        console.log("Existing unshield verifier:", unshieldVerifier);
        console.log("Uniswap V3 router:          ", router);

        vm.startBroadcast(key);
        dexAdapter = new UniswapV4Adapter(poolManager);
        address[] memory targets = new address[](2);
        targets[0] = router;
        targets[1] = address(dexAdapter);
        manager = new PoolV2RootManager(deployer, deployer);
        pool = new CurtainPoolV2(verifier, unshieldVerifier, tokens, address(manager), targets);
        manager.setPool(address(pool));
        vm.stopBroadcast();

        console.log("Uniswap V4 adapter:         ", address(dexAdapter));
        console.log("Pool V2:                    ", address(pool));
        console.log("Pool V2 root manager:       ", address(manager));
    }

    function _parseAddresses(string memory raw) internal view returns (address[] memory result) {
        bytes memory data = bytes(raw);
        if (data.length == 0) revert BadDeploymentInput();
        uint256 count = 1;
        for (uint256 i; i < data.length; ++i) if (data[i] == ",") ++count;
        result = new address[](count);
        uint256 start;
        uint256 index;
        for (uint256 i; i <= data.length; ++i) {
            if (i != data.length && data[i] != ",") continue;
            if (i == start) revert BadDeploymentInput();
            address token = vm.parseAddress(_slice(data, start, i));
            if (token == address(0) || token.code.length == 0) revert BadDeploymentInput();
            result[index++] = token;
            start = i + 1;
        }
    }

    function _slice(bytes memory data, uint256 start, uint256 end) private pure returns (string memory) {
        bytes memory out = new bytes(end - start);
        for (uint256 i; i < out.length; ++i) out[i] = data[start + i];
        return string(out);
    }
}
