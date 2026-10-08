// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {CRTN} from "../src/token/CRTN.sol";
import {CurtainStaking} from "../src/staking/CurtainStaking.sol";
import {CurtainVault} from "../src/vault/CurtainVault.sol";

/// @notice Deploys Curtain ($CRTN) Token and wires it into CurtainStaking & CurtainVault.
/// Total Supply: 100,000,000 CRTN minted to 4 designated buckets:
/// - 80% (80,000,000 CRTN) : Community / Shield Staking & Rewards
/// - 10% (10,000,000 CRTN) : Core Contributors / Team
/// - 5%  (5,000,000 CRTN)  : Early Backers / Advisory
/// - 5%  (5,000,000 CRTN)  : Broadcaster Subsidies & Protocol Reserve
///
/// Usage:
///   forge script script/DeployCRTN.s.sol:DeployCRTNScript --rpc-url <RPC> --broadcast --legacy
contract DeployCRTNScript is Script {
    using stdJson for string;

    uint256 internal constant RHC_CHAIN_ID = 4663;
    uint256 internal constant ANVIL_DEV_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    function run() external {
        string memory root = vm.projectRoot();
        string memory path = string.concat(root, "/deployments/4663.json");
        string memory json = vm.readFile(path);

        address admin = json.readAddress(".admin");
        address stakingAddr = json.readAddress(".staking");
        address vaultAddr = json.readAddress(".vault");

        bool production = block.chainid == RHC_CHAIN_ID;
        uint256 key = production ? vm.envUint("PRIVATE_KEY") : vm.envOr("PRIVATE_KEY", ANVIL_DEV_KEY);
        address deployer = vm.addr(key);

        address communityBucket = vm.envOr("COMMUNITY_BUCKET", admin);
        address teamBucket = vm.envOr("TEAM_BUCKET", admin);
        address backersBucket = vm.envOr("BACKERS_BUCKET", admin);
        address subsidiesBucket = vm.envOr("SUBSIDIES_BUCKET", admin);

        console.log("=== Curtain ($CRTN) Token Deployment ===");
        console.log("Deployer:          ", deployer);
        console.log("Admin:             ", admin);
        console.log("Community Bucket:  ", communityBucket);
        console.log("Team Bucket:       ", teamBucket);
        console.log("Backers Bucket:    ", backersBucket);
        console.log("Subsidies Bucket:  ", subsidiesBucket);

        vm.startBroadcast(key);

        CRTN crtn = new CRTN(communityBucket, teamBucket, backersBucket, subsidiesBucket);
        require(crtn.totalSupply() == 100_000_000 ether, "Total supply must be 100M CRTN");

        // If deployer is owner of staking, wire CRTN as both stake and reward token
        if (stakingAddr != address(0) && stakingAddr.code.length > 0) {
            CurtainStaking staking = CurtainStaking(stakingAddr);
            if (staking.owner() == deployer && address(staking.stakeToken()) == address(0)) {
                staking.setTokens(address(crtn), address(crtn));
                console.log("Wired CRTN to CurtainStaking contract successfully.");
            }
        }

        // If deployer is owner of vault, allowlist CRTN for private swaps
        if (vaultAddr != address(0) && vaultAddr.code.length > 0) {
            CurtainVault vault = CurtainVault(vaultAddr);
            if (vault.owner() == deployer && !vault.allowedToken(address(crtn))) {
                vault.setAllowedToken(address(crtn), true);
                console.log("Allowlisted CRTN on CurtainVault successfully.");
            }
        }

        vm.stopBroadcast();

        console.log("-----------------------------------------");
        console.log("CRTN Token Deployed:      ", address(crtn));
        console.log("Community Balance:        ", crtn.balanceOf(communityBucket) / 1e18, "CRTN");
        console.log("Team Balance:             ", crtn.balanceOf(teamBucket) / 1e18, "CRTN");
        console.log("Backers Balance:          ", crtn.balanceOf(backersBucket) / 1e18, "CRTN");
        console.log("Subsidies Balance:        ", crtn.balanceOf(subsidiesBucket) / 1e18, "CRTN");
        console.log("-----------------------------------------");
    }
}
