// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ObscuraBridgeV2.sol";

/**
 * @title DeployBridgeV2
 * @notice Deploys ObscuraBridgeV2 (2-of-3 multisig) to Sepolia.
 *
 * Usage:
 *   cd foundry-tests
 *   PRIVATE_KEY=0x... \
 *   SIGNER2=0x<address> \
 *   SIGNER3=0x<address> \
 *   forge script script/DeployBridgeV2.s.sol \
 *     --rpc-url https://eth-sepolia.g.alchemy.com/v2/XvxRMo30ODDpcwJroO83b \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast \
 *     --verify \
 *     --etherscan-api-key 7HKVCUWQJRGWYMY7WZA5XSP1PTSYZMI9TE
 *
 * If SIGNER2/SIGNER3 not set, all 3 signers default to the deployer address
 * (pseudo-multisig for testnet — still tests the contract logic).
 */
contract DeployBridgeV2 is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        // Signer 1: deployer (relayer on Falkenstein)
        address signer1 = deployer;
        // Signer 2: second key (separate machine in production)
        address signer2 = vm.envOr("SIGNER2", deployer);
        // Signer 3: cold wallet / hardware key in production
        address signer3 = vm.envOr("SIGNER3", deployer);

        address[] memory signers = new address[](3);
        signers[0] = signer1;
        signers[1] = signer2;
        signers[2] = signer3;

        uint256 threshold = 2; // 2-of-3

        vm.startBroadcast(deployerKey);

        ObscuraBridgeV2 bridge = new ObscuraBridgeV2(signers, threshold);

        console.log("ObscuraBridgeV2 deployed:", address(bridge));
        console.log("  USDC (Sepolia):", bridge.USDC());
        console.log("  Threshold:", threshold);
        console.log("  Signer 1 (relayer):", signer1);
        console.log("  Signer 2:", signer2);
        console.log("  Signer 3:", signer3);
        console.log("  Owner:", deployer);

        vm.stopBroadcast();
    }
}
