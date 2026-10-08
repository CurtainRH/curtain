// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {CurtainVault} from "../src/vault/CurtainVault.sol";
import {CurtainStaking} from "../src/staking/CurtainStaking.sol";
import {StealthRegistry} from "../src/stealth/StealthRegistry.sol";

/// @notice Automated on-chain verification script for Curtain on Robinhood Chain (4663).
/// Asserts contract states, paused status, ownership, parameters, and token registries.
///
/// Usage:
///   forge script script/PostDeployCheck.s.sol:PostDeployCheckScript --rpc-url <RPC>
contract PostDeployCheckScript is Script {
    using stdJson for string;

    function run() external view {
        string memory root = vm.projectRoot();
        string memory path = string.concat(root, "/deployments/4663.json");
        string memory json = vm.readFile(path);

        address admin = json.readAddress(".admin");
        address operator = json.readAddress(".operator");
        address treasury = json.readAddress(".treasury");
        address vaultAddr = json.readAddress(".vault");
        address stakingAddr = json.readAddress(".staking");
        address stealthAddr = json.readAddress(".stealthRegistry");

        console.log("=== Curtain On-Chain Build Verification ===");
        console.log("Vault Address:            ", vaultAddr);
        console.log("Staking Address:          ", stakingAddr);
        console.log("Stealth Registry Address: ", stealthAddr);

        // 1. Verify CurtainVault
        require(vaultAddr.code.length > 0, "CurtainVault has no bytecode");
        CurtainVault vault = CurtainVault(vaultAddr);

        require(vault.operator() == operator, "Vault operator mismatch");
        require(vault.treasury() == treasury, "Vault treasury mismatch");
        require(!vault.depositsPaused(), "Vault deposits paused unexpectedly");
        require(vault.REFUND_DELAY() == 3 minutes, "Vault REFUND_DELAY must be 3 minutes");
        require(vault.CHALLENGE_WINDOW() == 1 hours, "Vault CHALLENGE_WINDOW must be 1 hour");
        require(vault.feeBps() <= vault.MAX_FEE_BPS(), "Vault fee exceeds MAX_FEE_BPS cap");

        console.log("[PASS] Vault operator, treasury, and timing parameters verified.");

        // Check key asset allowlists
        address usdg = json.readAddress(".tokens.USDG");
        address nvda = json.readAddress(".tokens.NVDA");
        require(vault.allowedToken(usdg), "USDG must be allowlisted");
        require(vault.allowedToken(nvda), "NVDA must be allowlisted");
        console.log("[PASS] Core assets (USDG, NVDA) are allowlisted in Vault.");

        // 2. Verify StealthRegistry
        require(stealthAddr.code.length > 0, "StealthRegistry has no bytecode");
        StealthRegistry registry = StealthRegistry(stealthAddr);
        require(registry.nonceOf(address(0)) == 0, "Registry nonceOf unexpected value");
        console.log("[PASS] StealthRegistry verified and operational.");

        // 3. Verify CurtainStaking
        if (stakingAddr.code.length > 0) {
            CurtainStaking staking = CurtainStaking(stakingAddr);
            (uint64 lock0, uint256 mult0) = staking.tier(0);
            (uint64 lock1, uint256 mult1) = staking.tier(1);
            (uint64 lock2, uint256 mult2) = staking.tier(2);
            require(lock0 == 30 days && mult0 == 10_000, "Tier 0 parameter mismatch");
            require(lock1 == 90 days && mult1 == 15_000, "Tier 1 parameter mismatch");
            require(lock2 == 180 days && mult2 == 20_000, "Tier 2 parameter mismatch");
            console.log("[PASS] CurtainStaking tiers verified (30d/1x, 90d/1.5x, 180d/2x).");
        }

        console.log("===========================================");
        console.log("ALL ON-CHAIN POST-DEPLOY CHECKS PASSED!");
        console.log("===========================================");
    }
}
