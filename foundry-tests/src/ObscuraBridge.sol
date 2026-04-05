// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ObscuraBridge
 * @notice ZK Bridge — locks USDC on Ethereum so it can be claimed as
 *         bridged-USDC inside the Obscura rollup via a ZK storage proof.
 *
 * Flow:
 *   1. User calls deposit(amount, obscuraRecipient)
 *      → USDC transferred to this contract
 *      → Deposit stored in `deposits[depositId]`
 *      → DepositLocked event emitted
 *
 *   2. Relayer reads the deposit, generates SP1 storage proof:
 *      proves `deposits[depositId]` exists in this contract's storage
 *      at the finalized Ethereum block.
 *
 *   3. Relayer submits ZK proof to Obscura rollup.
 *      Rollup mints equivalent bridged-USDC to obscuraRecipient.
 *
 *   4. To withdraw: user calls requestWithdrawal(depositId, amount) from Obscura.
 *      Rollup burns bridged-USDC and emits a withdrawal proof.
 *      Relayer submits proof here → release() is called.
 *
 * Storage layout (deterministic for ZK proofs):
 *   deposits[id] is at keccak256(abi.encode(id, 3)) slot
 *   (mapping at slot 3)
 *
 * Deployed on: Ethereum Sepolia
 * USDC Sepolia: 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
 */

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract ObscuraBridge {

    // ── Constants ────────────────────────────────────────────────────────

    /// USDC on Sepolia testnet (Circle's official deployment)
    address public constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    /// Maximum deposit: 1,000,000 USDC (6 decimals)
    uint256 public constant MAX_DEPOSIT = 1_000_000 * 1e6;

    /// Minimum deposit: 1 USDC
    uint256 public constant MIN_DEPOSIT = 1e6;

    // ── State (slot 0..3) ────────────────────────────────────────────────

    address public owner;           // slot 0
    address public relayer;         // slot 1
    uint256 public nextDepositId;   // slot 2

    /// slot 3 — mapping used for ZK storage proofs
    /// Deposit.status: 0=empty, 1=locked, 2=released
    struct Deposit {
        address sender;          // Ethereum address that locked USDC
        bytes32 obscuraRecipient; // 32-byte address on Obscura rollup
        uint256 amount;          // USDC amount (6 decimals)
        uint64  timestamp;       // block.timestamp at deposit
        uint8   status;          // 0=empty 1=locked 2=released
    }
    mapping(uint256 => Deposit) public deposits; // slot 3

    /// Processed withdrawal nonces from Obscura → prevents replay
    mapping(bytes32 => bool) public usedWithdrawalNonces; // slot 4

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
        uint256 amount
    );

    event RelayerUpdated(address oldRelayer, address newRelayer);

    // ── Constructor ──────────────────────────────────────────────────────

    constructor(address _relayer) {
        owner   = msg.sender;
        relayer = _relayer;
    }

    // ── User: Deposit ────────────────────────────────────────────────────

    /**
     * @notice Lock USDC in the bridge to receive bridged-USDC on Obscura.
     * @param amount           USDC amount (6 decimals, e.g. 100_000_000 = 100 USDC)
     * @param obscuraRecipient 32-byte recipient address on Obscura Network
     * @return depositId       Unique deposit identifier
     */
    function deposit(
        uint256 amount,
        bytes32 obscuraRecipient
    ) external returns (uint256 depositId) {
        require(amount >= MIN_DEPOSIT, "ObscuraBridge: amount < minimum");
        require(amount <= MAX_DEPOSIT, "ObscuraBridge: amount > maximum");
        require(obscuraRecipient != bytes32(0), "ObscuraBridge: zero recipient");

        // Transfer USDC from sender
        bool ok = IERC20(USDC).transferFrom(msg.sender, address(this), amount);
        require(ok, "ObscuraBridge: USDC transfer failed");

        depositId = nextDepositId++;
        deposits[depositId] = Deposit({
            sender:          msg.sender,
            obscuraRecipient: obscuraRecipient,
            amount:          amount,
            timestamp:       uint64(block.timestamp),
            status:          1 // locked
        });

        emit DepositLocked(depositId, msg.sender, obscuraRecipient, amount, uint64(block.timestamp));
    }

    // ── Relayer: Release ─────────────────────────────────────────────────

    /**
     * @notice Release locked USDC to a recipient after a valid ZK withdrawal proof.
     *         Called by the relayer after verifying the Obscura rollup burn proof.
     * @param depositId        Original deposit ID
     * @param recipient        Ethereum address to receive USDC
     * @param withdrawalNonce  Unique nonce from the Obscura withdrawal (anti-replay)
     */
    function release(
        uint256 depositId,
        address recipient,
        bytes32 withdrawalNonce
    ) external onlyRelayer {
        require(!usedWithdrawalNonces[withdrawalNonce], "ObscuraBridge: nonce used");
        Deposit storage dep = deposits[depositId];
        require(dep.status == 1, "ObscuraBridge: not locked");

        usedWithdrawalNonces[withdrawalNonce] = true;
        dep.status = 2; // released

        bool ok = IERC20(USDC).transfer(recipient, dep.amount);
        require(ok, "ObscuraBridge: USDC release failed");

        emit DepositReleased(depositId, recipient, dep.amount);
    }

    // ── View helpers ─────────────────────────────────────────────────────

    /**
     * @notice Get deposit storage slot for ZK proof generation.
     *         deposits[id] occupies slot keccak256(id || 3).
     */
    function depositSlot(uint256 depositId) external pure returns (bytes32) {
        return keccak256(abi.encode(depositId, uint256(3)));
    }

    function getDeposit(uint256 depositId) external view returns (Deposit memory) {
        return deposits[depositId];
    }

    function totalLocked() external view returns (uint256) {
        return IERC20(USDC).balanceOf(address(this));
    }

    // ── Admin ────────────────────────────────────────────────────────────

    function setRelayer(address newRelayer) external onlyOwner {
        emit RelayerUpdated(relayer, newRelayer);
        relayer = newRelayer;
    }

    // ── Modifiers ────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "ObscuraBridge: not owner");
        _;
    }

    modifier onlyRelayer() {
        require(msg.sender == relayer, "ObscuraBridge: not relayer");
        _;
    }
}
