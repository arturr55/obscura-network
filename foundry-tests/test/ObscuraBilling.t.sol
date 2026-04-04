// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/ObscuraToken.sol";
import "../src/ObscuraBilling.sol";

// Minimal mock USDC (6 decimals)
contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "USDC: insufficient balance");
        require(allowance[from][msg.sender] >= amount, "USDC: insufficient allowance");
        balanceOf[from] -= amount;
        allowance[from][msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "USDC: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract ObscuraBillingTest is Test {
    ObscuraToken  obscura;
    MockUSDC      usdc;
    ObscuraBilling billing;

    address owner    = address(this);
    address treasury = address(0x100);
    address alice    = address(0x200);
    address bob      = address(0x300);
    address sequencer = address(0x400);

    uint256 constant USDC_99   = 99  * 10**6;
    uint256 constant USDC_499  = 499 * 10**6;
    uint256 constant USDC_1999 = 1999 * 10**6;
    uint256 constant USDC_01   = 100_000; // $0.10

    function setUp() public {
        usdc    = new MockUSDC();
        obscura = new ObscuraToken(address(this)); // owner gets all tokens
        billing = new ObscuraBilling(address(usdc), address(obscura), treasury);

        // Give alice and bob USDC
        usdc.mint(alice, 10_000 * 10**6);
        usdc.mint(bob,   10_000 * 10**6);

        // Approve billing contract
        vm.prank(alice);
        usdc.approve(address(billing), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(billing), type(uint256).max);
    }

    // ── Pay-per-tx ─────────────────────────────────────────────────────────

    function test_PayForTx_Basic() public {
        vm.prank(alice);
        billing.payForTx(10);

        assertEq(billing.remainingTx(alice), 10);
        assertEq(usdc.balanceOf(treasury), 10 * USDC_01);
    }

    function test_PayForTx_Zero_Reverts() public {
        vm.prank(alice);
        vm.expectRevert("Billing: zero txCount");
        billing.payForTx(0);
    }

    function test_ConsumeTx_DeductsCredit() public {
        vm.prank(alice);
        billing.payForTx(3);

        assertTrue(billing.canSubmitTx(alice));

        billing.consumeTx(alice); // called by owner (sequencer)
        assertEq(billing.remainingTx(alice), 2);

        billing.consumeTx(alice);
        billing.consumeTx(alice);
        assertEq(billing.remainingTx(alice), 0);
        assertFalse(billing.canSubmitTx(alice));
    }

    function test_ConsumeTx_NoCredits_ReturnsFalse() public {
        bool ok = billing.consumeTx(alice);
        assertFalse(ok);
    }

    // ── Subscriptions ──────────────────────────────────────────────────────

    function test_Subscribe_Starter() public {
        vm.prank(alice);
        billing.subscribe(1); // PLAN_STARTER

        assertTrue(billing.canSubmitTx(alice));
        assertEq(billing.remainingTx(alice), 500);
        assertEq(usdc.balanceOf(treasury), USDC_99);
    }

    function test_Subscribe_Business() public {
        vm.prank(alice);
        billing.subscribe(2); // PLAN_BUSINESS

        assertEq(billing.remainingTx(alice), 5000);
        assertEq(usdc.balanceOf(treasury), USDC_499);
    }

    function test_Subscribe_Enterprise_Unlimited() public {
        vm.prank(alice);
        billing.subscribe(3); // PLAN_ENTERPRISE

        assertEq(billing.remainingTx(alice), type(uint256).max);
        assertEq(usdc.balanceOf(treasury), USDC_1999);
    }

    function test_Subscribe_Starter_TxLimit() public {
        vm.prank(alice);
        billing.subscribe(1); // PLAN_STARTER

        // Use all 500 tx
        for (uint i = 0; i < 500; i++) {
            billing.consumeTx(alice);
        }

        // 501st should fail
        assertFalse(billing.canSubmitTx(alice));
        assertFalse(billing.consumeTx(alice));
    }

    function test_Subscribe_Expiry() public {
        vm.prank(alice);
        billing.subscribe(1); // PLAN_STARTER

        assertTrue(billing.canSubmitTx(alice));

        // Fast-forward 31 days
        vm.warp(block.timestamp + 31 days);

        assertFalse(billing.canSubmitTx(alice));
    }

    function test_Subscribe_Extend() public {
        vm.prank(alice);
        billing.subscribe(1); // PLAN_STARTER

        // Renew after 15 days
        vm.warp(block.timestamp + 15 days);
        vm.prank(alice);
        billing.subscribe(1); // PLAN_STARTER

        // tx counter should reset
        assertEq(billing.remainingTx(alice), 500);
    }

    function test_Subscribe_InvalidPlan_Reverts() public {
        vm.prank(alice);
        vm.expectRevert("Billing: invalid plan");
        billing.subscribe(4);
    }

    // ── OBSCURA discount ───────────────────────────────────────────────────

    function test_Discount_PayPerTx() public {
        // Give alice 1000 OBSCURA tokens
        obscura.transfer(alice, 1000 * 10**18);

        vm.prank(alice);
        billing.payForTx(10);

        // Should pay 60% of normal price: 10 * $0.10 * 0.6 = $0.60
        uint256 expected = 10 * USDC_01 * 6000 / 10000;
        assertEq(usdc.balanceOf(treasury), expected);
    }

    function test_Discount_Subscription() public {
        obscura.transfer(alice, 1000 * 10**18);

        vm.prank(alice);
        billing.subscribe(1); // PLAN_STARTER

        // Should pay 60% of $99 = $59.40
        uint256 expected = USDC_99 * 6000 / 10000;
        assertEq(usdc.balanceOf(treasury), expected);
    }

    function test_NoDiscount_Below_Threshold() public {
        // Give alice only 999 OBSCURA (below threshold)
        obscura.transfer(alice, 999 * 10**18);

        vm.prank(alice);
        billing.payForTx(1);

        // Should pay full price
        assertEq(usdc.balanceOf(treasury), USDC_01);
    }

    // ── Fallback: pay-per-tx after plan runs out ───────────────────────────

    function test_Fallback_To_PayPerTx_After_PlanLimit() public {
        vm.startPrank(alice);
        billing.subscribe(1); // PLAN_STARTER — 500 tx
        billing.payForTx(5);  // 5 extra credits
        vm.stopPrank();

        // Use all 500 plan tx
        for (uint i = 0; i < 500; i++) {
            billing.consumeTx(alice);
        }

        // Should fall back to pay-per-tx credits
        assertTrue(billing.canSubmitTx(alice));
        assertEq(billing.remainingTx(alice), 5);
    }

    // ── Admin ──────────────────────────────────────────────────────────────

    function test_SetPricePerTx() public {
        billing.setPricePerTx(200_000); // $0.20
        assertEq(billing.pricePerTx(), 200_000);
    }

    function test_SetPricePerTx_NotOwner_Reverts() public {
        vm.prank(alice);
        vm.expectRevert("Billing: not owner");
        billing.setPricePerTx(200_000);
    }

    function test_SetPlanPrice() public {
        billing.setPlanPrice(billing.PLAN_STARTER(), 149 * 10**6);
        assertEq(billing.planPrice(billing.PLAN_STARTER()), 149 * 10**6);
    }

    function test_SetTreasury() public {
        billing.setTreasury(alice);
        assertEq(billing.treasury(), alice);
    }
}
