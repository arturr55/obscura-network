// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/ObscuraToken.sol";

contract ObscuraTokenTest is Test {
    ObscuraToken token;
    address treasury = address(0x1);
    address alice    = address(0x2);
    address bob      = address(0x3);

    function setUp() public {
        token = new ObscuraToken(treasury);
    }

    function test_TotalSupply() public view {
        assertEq(token.totalSupply(), 1_000_000_000 * 10**18);
    }

    function test_TreasuryReceivesAllTokens() public view {
        assertEq(token.balanceOf(treasury), 1_000_000_000 * 10**18);
    }

    function test_Transfer() public {
        uint256 amount = 1000 * 10**18;
        vm.prank(treasury);
        token.transfer(alice, amount);
        assertEq(token.balanceOf(alice), amount);
        assertEq(token.balanceOf(treasury), token.totalSupply() - amount);
    }

    function test_TransferFail_InsufficientBalance() public {
        vm.prank(alice);
        vm.expectRevert("OBSCURA: insufficient balance");
        token.transfer(bob, 1);
    }

    function test_Approve_And_TransferFrom() public {
        uint256 amount = 500 * 10**18;
        vm.prank(treasury);
        token.approve(alice, amount);

        vm.prank(alice);
        token.transferFrom(treasury, bob, amount);

        assertEq(token.balanceOf(bob), amount);
        assertEq(token.allowance(treasury, alice), 0);
    }

    function test_TransferFrom_Fail_InsufficientAllowance() public {
        vm.prank(treasury);
        token.approve(alice, 100);

        vm.prank(alice);
        vm.expectRevert("OBSCURA: insufficient allowance");
        token.transferFrom(treasury, bob, 101);
    }

    function test_TransferOwnership() public {
        token.transferOwnership(alice);
        assertEq(token.owner(), alice);
    }

    function test_TransferOwnership_Fail_NotOwner() public {
        vm.prank(alice);
        vm.expectRevert("OBSCURA: not owner");
        token.transferOwnership(bob);
    }

    function test_NameAndSymbol() public view {
        assertEq(token.name(), "Obscura Network");
        assertEq(token.symbol(), "OBSCURA");
        assertEq(token.decimals(), 18);
    }
}
