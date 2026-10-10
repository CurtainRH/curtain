// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script, console } from "forge-std/Script.sol";
import { stdJson } from "forge-std/StdJson.sol";
import { CurtainStockStaking } from "../src/staking/CurtainStockStaking.sol";

/// @notice Deploys the stock-bundle CRTN staking contract and its initial immutable bundles.
/// @dev Uses the already-deployed CRTN and supported stock-token addresses in deployments/4663.json.
contract DeployCurtainStockStakingScript is Script {
    using stdJson for string;

    uint256 internal constant CHAIN_ID = 4663;
    address internal constant CRTN = 0x66A844fcbf4705Dbde3c97394d5a4C9822E8F35b;

    function run() external {
        require(block.chainid == CHAIN_ID, "wrong chain");
        string memory path = string.concat(vm.projectRoot(), "/deployments/4663.json");
        string memory json = vm.readFile(path);
        address operator = json.readAddress(".operator");
        uint256 key = vm.envUint("OPERATOR_PRIVATE_KEY");
        address deployer = vm.addr(key);
        require(deployer == operator, "key must match configured operator");
        require(CRTN.code.length > 0, "CRTN contract missing");

        vm.startBroadcast(key);
        CurtainStockStaking staking = new CurtainStockStaking(deployer, CRTN);
        _addInitialBundles(staking, json);
        vm.stopBroadcast();

        console.log("CurtainStockStaking:", address(staking));
        console.log("CRTN principal token:", CRTN);
        console.log("Owner / add-only registry:", deployer);
        console.log("Bundles:", staking.bundleCount());
        console.log("Reward assets:", staking.rewardAssetCount());
        console.log("Anyone may fund registered bundle constituents; there is no withdrawal/rescue method.");
    }

    function _addInitialBundles(CurtainStockStaking staking, string memory json) internal {
        address[] memory assets = new address[](2);
        uint16[] memory weights = new uint16[](2);
        assets[0] = json.readAddress(".tokens.SPY");
        assets[1] = json.readAddress(".tokens.QQQ");
        weights[0] = 6_000;
        weights[1] = 4_000;
        staking.addBundle("Market Core", assets, weights);

        assets = new address[](4);
        weights = new uint16[](4);
        assets[0] = json.readAddress(".tokens.SMH");
        assets[1] = json.readAddress(".tokens.NVDA");
        assets[2] = json.readAddress(".tokens.TSM");
        assets[3] = json.readAddress(".tokens.AMD");
        weights[0] = 4_000;
        weights[1] = 2_500;
        weights[2] = 2_000;
        weights[3] = 1_500;
        staking.addBundle("AI & Chips", assets, weights);

        assets = new address[](5);
        weights = new uint16[](5);
        assets[0] = json.readAddress(".tokens.AAPL");
        assets[1] = json.readAddress(".tokens.MSFT");
        assets[2] = json.readAddress(".tokens.AMZN");
        assets[3] = json.readAddress(".tokens.GOOGL");
        assets[4] = json.readAddress(".tokens.META");
        for (uint256 i; i < weights.length; ++i) {
            weights[i] = 2_000;
        }
        staking.addBundle("Platform Leaders", assets, weights);
    }
}
