// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ObscuraToken.sol";
import "../src/ObscuraBilling.sol";

/**
 * @title DeployObscura
 * @notice Deploys ObscuraToken + ObscuraBilling to any EVM network.
 *
 * Usage (Sepolia):
 *   forge script script/DeployObscura.s.sol \
 *     --rpc-url $SEPOLIA_RPC_URL \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast \
 *     --verify \
 *     --etherscan-api-key $ETHERSCAN_API_KEY
 *
 * For testnet without verify:
 *   forge script script/DeployObscura.s.sol \
 *     --rpc-url $SEPOLIA_RPC_URL \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast
 *
 * Sepolia USDC (Circle official): 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
 */
contract DeployObscura is Script {
    // Sepolia USDC (Circle official mock)
    address constant SEPOLIA_USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // 1. Deploy OBSCURA token (treasury = deployer)
        ObscuraToken token = new ObscuraToken(deployer);
        console.log("ObscuraToken deployed:", address(token));
        console.log("  Total supply:", token.totalSupply() / 10**18, "OBSCURA");
        console.log("  Treasury (deployer):", deployer);

        // 2. Deploy Billing contract
        ObscuraBilling billing = new ObscuraBilling(
            SEPOLIA_USDC,
            address(token),
            deployer  // treasury = deployer for now
        );
        console.log("ObscuraBilling deployed:", address(billing));
        console.log("  USDC:", SEPOLIA_USDC);
        console.log("  OBSCURA token:", address(token));
        console.log("  Treasury:", deployer);
        console.log("");
        console.log("Plans:");
        console.log("  Starter:    $99/mo  -> 500 tx");
        console.log("  Business:   $499/mo -> 5000 tx");
        console.log("  Enterprise: $1999/mo -> unlimited");

        vm.stopBroadcast();
    }
}
