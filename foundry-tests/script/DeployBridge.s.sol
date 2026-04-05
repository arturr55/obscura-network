// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ObscuraBridge.sol";

/**
 * @title DeployBridge
 * @notice Deploys ObscuraBridge to Sepolia.
 *
 * Usage:
 *   cd foundry-tests
 *   PRIVATE_KEY=0x... \
 *   SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/XvxRMo30ODDpcwJroO83b \
 *   forge script script/DeployBridge.s.sol \
 *     --rpc-url $SEPOLIA_RPC_URL \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast \
 *     --verify \
 *     --etherscan-api-key 7HKVCUWQJRGWYMY7WZA5XSP1PTSYZMI9TE
 */
contract DeployBridge is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        // Phase 1: deployer is the relayer (single trusted operator)
        // Phase 2: replace with multisig
        address relayer = deployer;

        vm.startBroadcast(deployerKey);

        ObscuraBridge bridge = new ObscuraBridge(relayer);

        console.log("ObscuraBridge deployed:", address(bridge));
        console.log("  USDC (Sepolia):", bridge.USDC());
        console.log("  Relayer:", relayer);
        console.log("  Owner:", deployer);
        console.log("");
        console.log("Storage slot for deposits[0]:");
        console.logBytes32(bridge.depositSlot(0));

        vm.stopBroadcast();
    }
}
