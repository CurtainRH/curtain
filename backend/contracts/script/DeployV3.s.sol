// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script, console } from "forge-std/Script.sol";
import { stdJson } from "forge-std/StdJson.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { CurtainVaultV3 } from "../src/vault/CurtainVaultV3.sol";

/// @notice Deploys the separate fixed-denomination V3 vault. V2 is never modified.
/// The initial policy is 1/10/100 whole units for assets and 100/1,000/10,000 USDG.
/// Denominations are owner-configurable after deployment.
contract DeployV3Script is Script {
    using stdJson for string;
    uint256 internal constant RHC_CHAIN_ID = 4663;
    uint256 internal constant ANVIL_DEV_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    string[45] internal symbols = [
        "AAPL",
        "AMC",
        "AMD",
        "AMZN",
        "BA",
        "COIN",
        "COST",
        "CRCL",
        "DELL",
        "DJT",
        "F",
        "GLD",
        "GLXY",
        "GME",
        "GOOGL",
        "HIMS",
        "IBM",
        "INTC",
        "JNJ",
        "LLY",
        "META",
        "MSFT",
        "MSTR",
        "NFLX",
        "NVDA",
        "PFE",
        "PLTR",
        "QQQ",
        "RBLX",
        "RDDT",
        "SGOV",
        "SHOP",
        "SLV",
        "SMCI",
        "SMH",
        "SOFI",
        "SPCX",
        "SPY",
        "TSLA",
        "TSM",
        "UPS",
        "USDG",
        "USO",
        "VTI",
        "XLK"
    ];

    function run() external {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/deployments/4663.json"));
        address operator = json.readAddress(".operator");
        address treasury = json.readAddress(".treasury");
        address router = json.readAddress(".router");
        address v4Adapter = json.readAddress(".v4Adapter");
        uint256 key = block.chainid == RHC_CHAIN_ID
            ? vm.envOr("PRIVATE_KEY", vm.envUint("OPERATOR_PRIVATE_KEY"))
            : vm.envOr("PRIVATE_KEY", ANVIL_DEV_KEY);
        address deployer = vm.addr(key);
        require(deployer == operator, "deploy key must be the configured operator");
        console.log("V3 deployer/operator:", deployer);

        address[] memory tokens = new address[](symbols.length * 3 + 1);
        uint256[] memory amounts = new uint256[](symbols.length * 3 + 1);
        uint256 amountIndex;
        for (uint256 i; i < symbols.length; ++i) {
            address token = json.readAddress(string.concat(".tokens.", symbols[i]));
            uint8 decimals = IERC20Metadata(token).decimals();
            uint256 unit = 10 ** uint256(decimals);
            uint256 base = keccak256(bytes(symbols[i])) == keccak256(bytes("USDG")) ? 10 : 1;
            tokens[amountIndex] = token;
            amounts[amountIndex++] = base * unit;
            tokens[amountIndex] = token;
            amounts[amountIndex++] = base * 10 * unit;
            tokens[amountIndex] = token;
            amounts[amountIndex++] = base * 100 * unit;
            if (keccak256(bytes(symbols[i])) == keccak256(bytes("USDG"))) {
                tokens[amountIndex] = token;
                amounts[amountIndex++] = base * 1000 * unit;
            }
        }
        address[] memory routers = new address[](2);
        routers[0] = router;
        routers[1] = v4Adapter;
        vm.startBroadcast(key);
        CurtainVaultV3 vault = new CurtainVaultV3(deployer, operator, treasury, tokens, amounts, routers);
        vm.stopBroadcast();
        console.log("CurtainVaultV3:", address(vault));
    }
}
