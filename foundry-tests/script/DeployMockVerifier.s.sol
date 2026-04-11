// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/MockSP1Verifier.sol";

/**
 * Deploy MockSP1Verifier and wire it into all ObscuraVault contracts.
 *
 * Usage:
 *   forge script script/DeployMockVerifier.s.sol \
 *     --rpc-url $ETH_SEPOLIA_RPC \
 *     --private-key $DEPLOY_PRIVATE_KEY \
 *     --broadcast
 *
 * After deploy, run UpdateVaults.s.sol to point each vault to the mock verifier.
 */
contract DeployMockVerifier is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOY_PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        MockSP1Verifier mock = new MockSP1Verifier();
        console.log("MockSP1Verifier deployed:", address(mock));

        vm.stopBroadcast();
    }
}
