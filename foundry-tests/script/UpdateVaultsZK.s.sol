// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";

interface IObscuraVault {
    function setSP1Verifier(address newVerifier) external;
    function setVKey(bytes32 newVKey) external;
}

/**
 * Point all ObscuraVault contracts to MockSP1Verifier and set vKey.
 *
 * Usage:
 *   MOCK_VERIFIER=0x... \
 *   forge script script/UpdateVaultsZK.s.sol \
 *     --rpc-url $ETH_SEPOLIA_RPC \
 *     --private-key $DEPLOY_PRIVATE_KEY \
 *     --broadcast
 *
 * Run once per chain (change --rpc-url each time).
 */
contract UpdateVaultsZK is Script {

    // vKey = keccak256("obscura-withdrawal-circuit-v1-testnet")
    // Placeholder until real vKey from `cargo prove build`
    bytes32 constant MOCK_VKEY = keccak256("obscura-withdrawal-circuit-v1-testnet");

    // Vault addresses per chain — update as needed
    address constant VAULT_ETH_SEPOLIA  = 0x25E5ea4b67394Ad2c2cfC69de20f01C2Df88cec1;
    address constant VAULT_ARB_SEPOLIA  = 0xA16591631B3eb7e77A89Fd146060B54d50d01a72;
    address constant VAULT_BASE_SEPOLIA = 0xA16591631B3eb7e77A89Fd146060B54d50d01a72;
    address constant VAULT_OP_SEPOLIA   = 0xA38e90adf5d9A28Bb554d8253F1e07DFfeb4C8b5;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOY_PRIVATE_KEY");
        address mockVerifier = vm.envAddress("MOCK_VERIFIER");

        // Detect which chain we're on and update the matching vault
        uint256 chainId = block.chainid;
        address vault;
        if      (chainId == 11155111) vault = VAULT_ETH_SEPOLIA;
        else if (chainId == 421614)   vault = VAULT_ARB_SEPOLIA;
        else if (chainId == 84532)    vault = VAULT_BASE_SEPOLIA;
        else if (chainId == 11155420) vault = VAULT_OP_SEPOLIA;
        else revert("Unknown chain");

        console.log("Chain:", chainId);
        console.log("Vault:", vault);
        console.log("MockVerifier:", mockVerifier);
        console.log("vKey:", vm.toString(MOCK_VKEY));

        vm.startBroadcast(deployerKey);
        IObscuraVault(vault).setSP1Verifier(mockVerifier);
        IObscuraVault(vault).setVKey(MOCK_VKEY);
        vm.stopBroadcast();

        console.log("Done. Vault now uses MockSP1Verifier.");
    }
}
