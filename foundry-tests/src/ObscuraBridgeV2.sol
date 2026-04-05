// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ObscuraBridgeV2
 * @notice ZK Bridge with 2-of-3 multisig relayer for withdrawal security.
 *
 * Upgrade over V1: instead of a single `relayer` address controlling all
 * releases, V2 requires M-of-N signatures from a set of designated relayer
 * signers. Default: 2-of-3 (threshold=2, relayers.length=3).
 *
 * Withdrawal flow:
 *   1. User calls requestWithdraw on Obscura rollup.
 *   2. Each relayer independently verifies the rollup TX and signs:
 *        keccak256(abi.encodePacked(depositId, recipient, nonce, chainId))
 *   3. Any party collects >= threshold valid signatures and calls
 *        releaseMultisig(depositId, recipient, nonce, signatures).
 *   4. Contract verifies signatures, checks threshold, releases USDC.
 *
 * Security properties:
 *   - Single compromised relayer key cannot steal funds.
 *   - Resistant to front-running (nonce + chainId in signed payload).
 *   - Replay protection via usedWithdrawalNonces mapping.
 *   - Owner (multisig-safe in production) can rotate signers.
 *
 * Deployed on: Ethereum Sepolia
 */

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract ObscuraBridgeV2 {

    // ── Constants ────────────────────────────────────────────────────────

    address public constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    uint256 public constant MAX_DEPOSIT = 1_000_000 * 1e6;
    uint256 public constant MIN_DEPOSIT = 1e6;
    uint256 public constant MAX_SIGNERS = 10;

    // ── State ────────────────────────────────────────────────────────────

    address public owner;
    uint256 public threshold;          // minimum signatures required
    address[] public relayerSigners;   // list of authorised signers

    uint256 public nextDepositId;

    struct Deposit {
        address sender;
        bytes32 obscuraRecipient;
        uint256 amount;
        uint64  timestamp;
        uint8   status;   // 0=empty 1=locked 2=released
    }
    mapping(uint256 => Deposit) public deposits;
    mapping(bytes32 => bool)    public usedWithdrawalNonces;

    // ── Events ───────────────────────────────────────────────────────────

    event DepositLocked(
        uint256 indexed depositId,
        address indexed sender,
        bytes32 indexed obscuraRecipient,
        uint256 amount,
        uint64  timestamp
    );
    event DepositReleased(
        uint256 indexed depositId,
        address indexed recipient,
        uint256 amount,
        address[2] signers
    );
    event SignerAdded(address signer);
    event SignerRemoved(address signer);
    event ThresholdChanged(uint256 oldThreshold, uint256 newThreshold);

    // ── Constructor ──────────────────────────────────────────────────────

    /**
     * @param _signers   Initial set of relayer signers (e.g. 3 addresses).
     * @param _threshold Minimum number of signatures required (e.g. 2).
     */
    constructor(address[] memory _signers, uint256 _threshold) {
        require(_signers.length >= _threshold, "threshold > signers");
        require(_threshold >= 1, "threshold must be >= 1");
        require(_signers.length <= MAX_SIGNERS, "too many signers");

        owner = msg.sender;
        threshold = _threshold;
        for (uint i = 0; i < _signers.length; i++) {
            require(_signers[i] != address(0), "zero signer");
            relayerSigners.push(_signers[i]);
        }
    }

    // ── Deposit (unchanged from V1) ──────────────────────────────────────

    function deposit(
        uint256 amount,
        bytes32 obscuraRecipient
    ) external returns (uint256 depositId) {
        require(amount >= MIN_DEPOSIT, "amount < minimum");
        require(amount <= MAX_DEPOSIT, "amount > maximum");
        require(obscuraRecipient != bytes32(0), "zero recipient");

        require(
            IERC20(USDC).transferFrom(msg.sender, address(this), amount),
            "USDC transfer failed"
        );

        depositId = nextDepositId++;
        deposits[depositId] = Deposit({
            sender:           msg.sender,
            obscuraRecipient: obscuraRecipient,
            amount:           amount,
            timestamp:        uint64(block.timestamp),
            status:           1
        });

        emit DepositLocked(depositId, msg.sender, obscuraRecipient, amount, uint64(block.timestamp));
    }

    // ── Multisig Release ─────────────────────────────────────────────────

    /**
     * @notice Release USDC after collecting threshold valid relayer signatures.
     *
     * @param depositId        Original deposit ID.
     * @param recipient        Ethereum address receiving USDC.
     * @param withdrawalNonce  Anti-replay nonce from the Obscura rollup.
     * @param signatures       Array of ECDSA signatures from relayer signers.
     *                         Must have >= threshold valid, non-duplicate signers.
     *
     * Signed message (EIP-191 personal_sign style):
     *   keccak256(abi.encodePacked(
     *       "\x19Ethereum Signed Message:\n32",
     *       keccak256(abi.encodePacked(depositId, recipient, withdrawalNonce, block.chainid))
     *   ))
     */
    function releaseMultisig(
        uint256 depositId,
        address recipient,
        bytes32 withdrawalNonce,
        bytes[] calldata signatures
    ) external {
        require(!usedWithdrawalNonces[withdrawalNonce], "nonce already used");
        require(deposits[depositId].status == 1, "deposit not locked");
        require(recipient != address(0), "zero recipient");
        require(signatures.length >= threshold, "not enough signatures provided");

        // Build the message hash that each relayer should have signed
        bytes32 payloadHash = keccak256(
            abi.encodePacked(depositId, recipient, withdrawalNonce, block.chainid)
        );
        bytes32 msgHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", payloadHash)
        );

        // Verify signatures and count unique valid signers
        uint256 validCount = 0;
        address[10] memory seen;  // track signers to prevent duplicate use

        for (uint i = 0; i < signatures.length && validCount < threshold; i++) {
            address recovered = recoverSigner(msgHash, signatures[i]);
            if (_isRelayer(recovered) && !_inArray(seen, recovered, validCount)) {
                seen[validCount] = recovered;
                validCount++;
            }
        }

        require(validCount >= threshold, "insufficient valid signatures");

        // Execute release
        usedWithdrawalNonces[withdrawalNonce] = true;
        deposits[depositId].status = 2;

        require(
            IERC20(USDC).transfer(recipient, deposits[depositId].amount),
            "USDC release failed"
        );

        address[2] memory topSigners = [seen[0], seen[1]];
        emit DepositReleased(depositId, recipient, deposits[depositId].amount, topSigners);
    }

    // ── View helpers ─────────────────────────────────────────────────────

    function getDeposit(uint256 id) external view returns (Deposit memory) {
        return deposits[id];
    }

    function totalLocked() external view returns (uint256) {
        return IERC20(USDC).balanceOf(address(this));
    }

    function depositSlot(uint256 id) external pure returns (bytes32) {
        return keccak256(abi.encode(id, uint256(3)));
    }

    function getSigners() external view returns (address[] memory) {
        return relayerSigners;
    }

    /**
     * @notice Hash that relayers must sign for a given release.
     *         Use eth_sign or personal_sign with this payload.
     */
    function releaseHash(
        uint256 depositId,
        address recipient,
        bytes32 withdrawalNonce
    ) external view returns (bytes32) {
        return keccak256(
            abi.encodePacked(depositId, recipient, withdrawalNonce, block.chainid)
        );
    }

    // ── Admin ────────────────────────────────────────────────────────────

    function addSigner(address signer) external onlyOwner {
        require(signer != address(0), "zero address");
        require(!_isRelayer(signer), "already a signer");
        require(relayerSigners.length < MAX_SIGNERS, "too many signers");
        relayerSigners.push(signer);
        emit SignerAdded(signer);
    }

    function removeSigner(address signer) external onlyOwner {
        require(relayerSigners.length > threshold, "would break threshold");
        for (uint i = 0; i < relayerSigners.length; i++) {
            if (relayerSigners[i] == signer) {
                relayerSigners[i] = relayerSigners[relayerSigners.length - 1];
                relayerSigners.pop();
                emit SignerRemoved(signer);
                return;
            }
        }
        revert("signer not found");
    }

    function setThreshold(uint256 newThreshold) external onlyOwner {
        require(newThreshold >= 1, "threshold must be >= 1");
        require(newThreshold <= relayerSigners.length, "threshold > signer count");
        emit ThresholdChanged(threshold, newThreshold);
        threshold = newThreshold;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        owner = newOwner;
    }

    // ── Internal helpers ─────────────────────────────────────────────────

    function _isRelayer(address addr) internal view returns (bool) {
        for (uint i = 0; i < relayerSigners.length; i++) {
            if (relayerSigners[i] == addr) return true;
        }
        return false;
    }

    function _inArray(address[10] memory arr, address addr, uint len) internal pure returns (bool) {
        for (uint i = 0; i < len; i++) {
            if (arr[i] == addr) return true;
        }
        return false;
    }

    function recoverSigner(bytes32 msgHash, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "invalid sig length");
        bytes32 r;
        bytes32 s;
        uint8   v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "invalid v");
        return ecrecover(msgHash, v, r, s);
    }

    // ── Modifiers ────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }
}
