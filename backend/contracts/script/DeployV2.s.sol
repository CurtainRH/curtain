// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {CurtainVault} from "../src/vault/CurtainVault.sol";
import {StealthRegistry} from "../src/stealth/StealthRegistry.sol";

/// @notice Deploys CurtainVault V2 and StealthRegistry V2 on Robinhood Chain (4663) or local fork.
/// Automatically reads allowlisted tokens, routers, operator and admin from deployments/4663.json.
///
/// Usage:
///   forge script script/DeployV2.s.sol:DeployV2Script --rpc-url <RPC> --broadcast --legacy
contract DeployV2Script is Script {
    using stdJson for string;

    uint256 internal constant RHC_CHAIN_ID = 4663;
    uint256 internal constant ANVIL_DEV_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    CurtainVault internal vault;
    StealthRegistry internal registry;

    function run() external {
        string memory root = vm.projectRoot();
        string memory path = string.concat(root, "/deployments/4663.json");
        string memory json = vm.readFile(path);

        address admin = json.readAddress(".admin");
        address operator = json.readAddress(".operator");
        address treasury = json.readAddress(".treasury");
        address router = json.readAddress(".router");
        address v4Adapter = json.readAddress(".v4Adapter");

        bool production = block.chainid == RHC_CHAIN_ID;
        uint256 key = production ? vm.envUint("PRIVATE_KEY") : vm.envOr("PRIVATE_KEY", ANVIL_DEV_KEY);
        address deployer = vm.addr(key);

        console.log("Deployer:          ", deployer);
        console.log("Operator (fixed):  ", operator);
        console.log("Admin:             ", admin);
        console.log("Treasury:          ", treasury);
        console.log("DEX Router:        ", router);
        console.log("V4 Adapter:        ", v4Adapter);

        vm.startBroadcast(key);

        // Deploy Vault V2 and StealthRegistry V2
        vault = new CurtainVault(deployer, operator, treasury);
        registry = new StealthRegistry();

        // Allowlist DEX Routers
        if (router != address(0) && router.code.length > 0) {
            vault.setAllowedRouter(router, true);
        }
        if (v4Adapter != address(0) && v4Adapter.code.length > 0) {
            vault.setAllowedRouter(v4Adapter, true);
        }

        // Allowlist all tokens configured in 4663.json
        string[46] memory symbols = [
            "AAPL", "AMC", "AMD", "AMZN", "BA", "COIN", "COST", "CRCL", "DELL", "DJT",
            "F", "GLD", "GLXY", "GME", "GOOGL", "HIMS", "IBM", "INTC", "JNJ", "LLY",
            "META", "MSFT", "MSTR", "NFLX", "NVDA", "PFE", "PLTR", "QQQ", "RBLX", "RDDT",
            "SGOV", "SHOP", "SLV", "SMCI", "SMH", "SOFI", "SPCX", "SPY", "TSLA", "TSM",
            "UPS", "USDG", "USO", "VTI", "XLK", "HOOD"
        ];

        uint256 allowedCount = 0;
        for (uint256 i = 0; i < symbols.length; i++) {
            string memory tokenKey = string.concat(".tokens.", symbols[i]);
            if (vm.keyExists(json, tokenKey)) {
                address tokenAddr = json.readAddress(tokenKey);
                if (tokenAddr != address(0) && (tokenAddr.code.length > 0 || !production)) {
                    vault.setAllowedToken(tokenAddr, true);
                    allowedCount++;
                }
            }
        }

        // Transfer ownership to admin if deployer != admin
        if (admin != deployer) {
            vault.transferOwnership(admin);
        }

        vm.stopBroadcast();

        console.log("-----------------------------------------");
        console.log("Vault V2 Deployed:        ", address(vault));
        console.log("StealthRegistry Deployed: ", address(registry));
        console.log("Tokens Allowlisted:       ", allowedCount);
        console.log("-----------------------------------------");
        if (admin != deployer) {
            console.log("NOTE: Admin must call acceptOwnership() on the new vault to finalize transfer.");
        }

        // Update 4663.json with new addresses
        string memory updatedJson = vm.serializeString("root", "admin", vm.toString(admin));
        vm.serializeUint("root", "chainId", block.chainid);
        vm.serializeAddress("root", "operator", operator);
        vm.serializeBool("root", "production", production);
        vm.serializeAddress("root", "router", router);
        vm.serializeAddress("root", "staking", json.readAddress(".staking"));
        vm.serializeAddress("root", "stealthAnnouncer", json.readAddress(".stealthAnnouncer"));
        vm.serializeAddress("root", "stealthRegistry", address(registry));
        vm.serializeAddress("root", "treasury", treasury);
        vm.serializeAddress("root", "v4Adapter", v4Adapter);
        vm.serializeAddress("root", "vault", address(vault));

        // Re-serialize tokens object
        for (uint256 i = 0; i < symbols.length; i++) {
            string memory tokenKey = string.concat(".tokens.", symbols[i]);
            if (vm.keyExists(json, tokenKey)) {
                address tokenAddr = json.readAddress(tokenKey);
                vm.serializeAddress("tokens_obj", symbols[i], tokenAddr);
            }
        }
        string memory tokensSerialized = vm.serializeAddress("tokens_obj", "USDG", json.readAddress(".tokens.USDG"));
        updatedJson = vm.serializeString("root", "tokens", tokensSerialized);

        // Write only when broadcast/production
        if (production) {
            vm.writeJson(updatedJson, path);
            console.log("Updated deployments/4663.json with new Vault and StealthRegistry addresses.");
        }
    }
}
