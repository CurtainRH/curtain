// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {CurtainVault} from "../src/vault/CurtainVault.sol";
import {CurtainStaking} from "../src/staking/CurtainStaking.sol";
import {StealthRegistry} from "../src/stealth/StealthRegistry.sol";
import {CurtainPoolV2} from "../src/pool/CurtainPoolV2.sol";
import {PoolV2RootManager} from "../src/pool/PoolV2RootManager.sol";

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
        address poolV2Addr = json.readAddress(".poolV2");
        address poolV2RootManagerAddr = json.readAddress(".poolV2RootManager");
        address poolV2AdapterAddr = json.readAddress(".poolV2DexAdapter");

        console.log("=== Curtain On-Chain Build Verification ===");
        console.log("Vault Address:            ", vaultAddr);
        console.log("Staking Address:          ", stakingAddr);
        console.log("Stealth Registry Address: ", stealthAddr);
        console.log("Pool V2 Address:          ", poolV2Addr);
        console.log("Pool V2 Root Manager:     ", poolV2RootManagerAddr);

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

        // 4. Verify the current fund-holding Pool V2 deployment and its wiring.
        require(poolV2Addr.code.length > 0, "PoolV2 has no bytecode");
        require(poolV2RootManagerAddr.code.length > 0, "PoolV2 root manager has no bytecode");
        require(poolV2AdapterAddr.code.length > 0, "PoolV2 swap adapter has no bytecode");

        CurtainPoolV2 poolV2 = CurtainPoolV2(poolV2Addr);
        PoolV2RootManager rootManager = PoolV2RootManager(poolV2RootManagerAddr);
        require(poolV2.rootManager() == poolV2RootManagerAddr, "PoolV2 root manager mismatch");
        require(address(rootManager.pool()) == poolV2Addr, "Root manager pool mismatch");
        require(rootManager.publisher() != address(0), "Root manager publisher is zero");
        require(address(poolV2.verifier()).code.length > 0, "PoolV2 transfer verifier has no bytecode");
        require(address(poolV2.unshieldVerifier()).code.length > 0, "PoolV2 unshield verifier has no bytecode");
        require(poolV2.currentRoot() != bytes32(0), "PoolV2 has no published root");
        require(poolV2.immutableToken(usdg), "PoolV2 USDG is not allowlisted");
        require(poolV2.immutableToken(nvda), "PoolV2 NVDA is not allowlisted");
        require(poolV2.swapTarget(poolV2AdapterAddr), "PoolV2 swap adapter is not allowlisted");
        console.log("[PASS] PoolV2 code, verifiers, root manager, root, tokens, and swap adapter verified.");

        console.log("===========================================");
        console.log("ALL ON-CHAIN POST-DEPLOY CHECKS PASSED!");
        console.log("===========================================");
    }
}
