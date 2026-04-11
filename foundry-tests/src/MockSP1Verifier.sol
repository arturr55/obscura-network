// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockSP1Verifier
 * @notice Testnet-only SP1 verifier that always succeeds.
 *
 * Used to test the full releaseWithProof() flow on testnet without needing
 * a real Succinct Prover Network key. The relayer computes correct publicValues
 * from on-chain deposit data — the proof bytes are ignored.
 *
 * NEVER deploy to mainnet.
 */
contract MockSP1Verifier {
    event ProofVerified(bytes32 indexed vkey, bytes publicValues);

    function verifyProof(
        bytes32 vkey,
        bytes calldata publicValues,
        bytes calldata /* proofBytes */
    ) external view {
        // Always succeeds — testnet only.
        // Validate minimum structure: publicValues must be 224 bytes (7 × 32).
        require(publicValues.length == 224, "MockSP1Verifier: bad publicValues length");
        require(vkey != bytes32(0), "MockSP1Verifier: zero vkey");
    }
}
