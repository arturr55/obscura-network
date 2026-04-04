// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ObscuraBilling
 * @notice Handles subscription and pay-per-tx payments for Obscura Network.
 *
 * ## Payment modes
 *
 * 1. Pay-per-tx (USDC):
 *    User calls payForTx(txCount) → pays txCount * pricePerTx USDC
 *    Sequencer checks tx credits before processing
 *
 * 2. Monthly subscription (USDC):
 *    User calls subscribe(plan) → pays fixed monthly fee
 *    Gets unlimited txs for 30 days
 *
 * 3. OBSCURA discount:
 *    If user holds >= DISCOUNT_THRESHOLD OBSCURA tokens →
 *    pays 60% of normal price (40% discount)
 *
 * ## Plans
 *   Starter  : $99/mo  → 500 tx included
 *   Business : $499/mo → 5,000 tx included
 *   Enterprise: $1,999/mo → unlimited tx
 */
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract ObscuraBilling {
    // ── Constants ─────────────────────────────────────────────────────────

    uint256 public constant DISCOUNT_THRESHOLD = 1000 * 10**18; // 1000 OBSCURA = discount
    uint256 public constant DISCOUNT_BPS       = 6000;          // 60% of price (40% off)
    uint256 public constant BPS_DENOMINATOR    = 10000;

    uint8 public constant PLAN_NONE       = 0;
    uint8 public constant PLAN_STARTER    = 1; // $99/mo,    500 tx
    uint8 public constant PLAN_BUSINESS   = 2; // $499/mo,  5000 tx
    uint8 public constant PLAN_ENTERPRISE = 3; // $1999/mo, unlimited

    // ── State ─────────────────────────────────────────────────────────────

    address public owner;
    address public treasury;      // receives all payments
    IERC20  public usdc;
    IERC20  public obscuraToken;

    // Pay-per-tx price in USDC (6 decimals): $0.10 = 100_000
    uint256 public pricePerTx = 100_000; // $0.10

    // Subscription prices in USDC (6 decimals)
    mapping(uint8 => uint256) public planPrice;   // plan → monthly price
    mapping(uint8 => uint256) public planTxLimit; // plan → tx per month (0 = unlimited)

    // User state
    struct UserState {
        uint256 txCredits;       // pay-per-tx credits remaining
        uint8   activePlan;      // current subscription plan
        uint256 planExpiry;      // unix timestamp when subscription expires
        uint256 planTxUsed;      // tx used in current subscription period
    }
    mapping(address => UserState) public users;

    // ── Events ────────────────────────────────────────────────────────────

    event TxCreditsPurchased(address indexed user, uint256 txCount, uint256 usdcPaid);
    event Subscribed(address indexed user, uint8 plan, uint256 expiry, uint256 usdcPaid);
    event TxConsumed(address indexed user, uint256 remaining);
    event PriceUpdated(uint256 newPricePerTx);
    event PlanPriceUpdated(uint8 plan, uint256 newPrice);

    // ── Constructor ───────────────────────────────────────────────────────

    constructor(address _usdc, address _obscuraToken, address _treasury) {
        owner         = msg.sender;
        usdc          = IERC20(_usdc);
        obscuraToken  = IERC20(_obscuraToken);
        treasury      = _treasury;

        // Starter: $99
        planPrice[PLAN_STARTER]    = 99 * 10**6;
        planTxLimit[PLAN_STARTER]  = 500;

        // Business: $499
        planPrice[PLAN_BUSINESS]   = 499 * 10**6;
        planTxLimit[PLAN_BUSINESS] = 5000;

        // Enterprise: $1999, unlimited (0)
        planPrice[PLAN_ENTERPRISE]   = 1999 * 10**6;
        planTxLimit[PLAN_ENTERPRISE] = 0;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Billing: not owner");
        _;
    }

    // ── User functions ────────────────────────────────────────────────────

    /**
     * @notice Buy pay-per-tx credits.
     * @param txCount Number of transactions to buy.
     */
    function payForTx(uint256 txCount) external {
        require(txCount > 0, "Billing: zero txCount");
        uint256 price = _applyDiscount(pricePerTx * txCount, msg.sender);
        require(usdc.transferFrom(msg.sender, treasury, price), "Billing: USDC transfer failed");
        users[msg.sender].txCredits += txCount;
        emit TxCreditsPurchased(msg.sender, txCount, price);
    }

    /**
     * @notice Subscribe to a monthly plan.
     * @param plan PLAN_STARTER, PLAN_BUSINESS, or PLAN_ENTERPRISE.
     */
    function subscribe(uint8 plan) external {
        require(plan >= PLAN_STARTER && plan <= PLAN_ENTERPRISE, "Billing: invalid plan");
        uint256 price = _applyDiscount(planPrice[plan], msg.sender);
        require(usdc.transferFrom(msg.sender, treasury, price), "Billing: USDC transfer failed");

        UserState storage u = users[msg.sender];
        // Extend if already subscribed, otherwise start fresh
        uint256 start = block.timestamp > u.planExpiry ? block.timestamp : u.planExpiry;
        u.activePlan  = plan;
        u.planExpiry  = start + 30 days;
        u.planTxUsed  = 0;

        emit Subscribed(msg.sender, plan, u.planExpiry, price);
    }

    // ── Sequencer functions ───────────────────────────────────────────────

    /**
     * @notice Called by sequencer to consume one tx credit for a user.
     * @dev Returns true if user had sufficient credits/subscription.
     */
    function consumeTx(address user) external onlyOwner returns (bool) {
        UserState storage u = users[user];

        // Check active subscription first
        if (u.activePlan != PLAN_NONE && block.timestamp < u.planExpiry) {
            uint256 limit = planTxLimit[u.activePlan];
            if (limit == 0) {
                // Enterprise: unlimited
                u.planTxUsed++;
                emit TxConsumed(user, type(uint256).max);
                return true;
            }
            if (u.planTxUsed < limit) {
                u.planTxUsed++;
                emit TxConsumed(user, limit - u.planTxUsed);
                return true;
            }
            // Plan limit reached — fall through to pay-per-tx credits
        }

        // Check pay-per-tx credits
        if (u.txCredits > 0) {
            u.txCredits--;
            emit TxConsumed(user, u.txCredits);
            return true;
        }

        return false; // no credits
    }

    /**
     * @notice Check if user can submit a transaction (view, no state change).
     */
    function canSubmitTx(address user) external view returns (bool) {
        UserState storage u = users[user];
        if (u.activePlan != PLAN_NONE && block.timestamp < u.planExpiry) {
            uint256 limit = planTxLimit[u.activePlan];
            if (limit == 0 || u.planTxUsed < limit) return true;
        }
        return u.txCredits > 0;
    }

    /**
     * @notice Returns remaining tx capacity for a user.
     * Returns type(uint256).max for unlimited Enterprise plan.
     */
    function remainingTx(address user) external view returns (uint256) {
        UserState storage u = users[user];
        if (u.activePlan != PLAN_NONE && block.timestamp < u.planExpiry) {
            uint256 limit = planTxLimit[u.activePlan];
            if (limit == 0) return type(uint256).max;
            if (u.planTxUsed < limit) return limit - u.planTxUsed;
        }
        return u.txCredits;
    }

    // ── Admin functions ───────────────────────────────────────────────────

    function setPricePerTx(uint256 newPrice) external onlyOwner {
        pricePerTx = newPrice;
        emit PriceUpdated(newPrice);
    }

    function setPlanPrice(uint8 plan, uint256 newPrice) external onlyOwner {
        planPrice[plan] = newPrice;
        emit PlanPriceUpdated(plan, newPrice);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Billing: zero address");
        treasury = newTreasury;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Billing: zero address");
        owner = newOwner;
    }

    // ── Internal ──────────────────────────────────────────────────────────

    function _applyDiscount(uint256 basePrice, address user) internal view returns (uint256) {
        if (obscuraToken.balanceOf(user) >= DISCOUNT_THRESHOLD) {
            return basePrice * DISCOUNT_BPS / BPS_DENOMINATOR;
        }
        return basePrice;
    }
}
