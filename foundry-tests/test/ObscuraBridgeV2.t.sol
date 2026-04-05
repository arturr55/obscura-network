// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/ObscuraBridgeV2.sol";

/**
 * Mock USDC for testing (6 decimals, mintable).
 */
contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        require(balanceOf[from] >= amount, "balance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/**
 * Bridge V2 that uses a swappable USDC address (for tests).
 */
contract TestBridgeV2 is ObscuraBridgeV2 {
    address public testUsdc;

    constructor(address[] memory signers, uint256 thresh, address _usdc)
        ObscuraBridgeV2(signers, thresh)
    {
        testUsdc = _usdc;
    }

    // Override USDC constant by delegating to testUsdc
    function _usdc() internal view returns (IERC20) {
        return IERC20(testUsdc);
    }
}

contract ObscuraBridgeV2Test is Test {

    // Three relayer private keys (deterministic from Foundry cheatcodes)
    uint256 constant PK1 = 0xA1;
    uint256 constant PK2 = 0xA2;
    uint256 constant PK3 = 0xA3;

    address relayer1;
    address relayer2;
    address relayer3;
    address user;
    address owner;

    MockUSDC usdc;
    ObscuraBridgeV2 bridge;

    uint256 constant ONE_USDC = 1e6;

    function setUp() public {
        relayer1 = vm.addr(PK1);
        relayer2 = vm.addr(PK2);
        relayer3 = vm.addr(PK3);
        user  = makeAddr("user");
        owner = makeAddr("owner");

        usdc = new MockUSDC();

        // Deploy bridge — but we need to override USDC constant.
        // Use vm.etch to deploy a patched version, or just test with real USDC addr
        // by forking. For unit tests we'll deploy with a helper contract.
        // Workaround: deploy via a derived contract that overrides USDC.
        // Since ObscuraBridgeV2 hardcodes USDC, we use a fork-free approach:
        // deploy the contract and deal USDC via vm.mockCall.

        address[] memory signers = new address[](3);
        signers[0] = relayer1;
        signers[1] = relayer2;
        signers[2] = relayer3;

        vm.prank(owner);
        bridge = new ObscuraBridgeV2(signers, 2);

        // Mock USDC calls so we don't need a real ERC-20
        // transferFrom: always return true and track balance in mock
        // We'll use vm.mockCall for ERC-20 interactions.
        address usdcAddr = bridge.USDC();

        // Fund user with USDC (mock balance)
        vm.mockCall(usdcAddr, abi.encodeWithSelector(IERC20.transferFrom.selector), abi.encode(true));
        vm.mockCall(usdcAddr, abi.encodeWithSelector(IERC20.transfer.selector),     abi.encode(true));
        vm.mockCall(usdcAddr, abi.encodeWithSelector(IERC20.balanceOf.selector),    abi.encode(100 * ONE_USDC));
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    function _deposit(uint256 amount) internal returns (uint256 depositId) {
        vm.prank(user);
        depositId = bridge.deposit(amount, bytes32(uint256(uint160(user))));
    }

    function _sign(uint256 pk, bytes32 hash) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, hash);
        return abi.encodePacked(r, s, v);
    }

    function _releaseHash(uint256 depositId, address recipient, bytes32 nonce)
        internal view returns (bytes32)
    {
        bytes32 payload = keccak256(
            abi.encodePacked(depositId, recipient, nonce, block.chainid)
        );
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", payload));
    }

    // ── Tests ────────────────────────────────────────────────────────────

    function test_constructor_sets_signers_and_threshold() public view {
        assertEq(bridge.threshold(), 2);
        address[] memory s = bridge.getSigners();
        assertEq(s.length, 3);
        assertEq(s[0], relayer1);
        assertEq(s[1], relayer2);
        assertEq(s[2], relayer3);
    }

    function test_deposit_succeeds() public {
        uint256 id = _deposit(10 * ONE_USDC);
        ObscuraBridgeV2.Deposit memory dep = bridge.getDeposit(id);
        assertEq(dep.status, 1);
        assertEq(dep.amount, 10 * ONE_USDC);
        assertEq(dep.sender, user);
    }

    function test_release_with_two_valid_signatures() public {
        uint256 id = _deposit(10 * ONE_USDC);
        bytes32 nonce = keccak256("nonce-1");
        bytes32 hash  = _releaseHash(id, user, nonce);

        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(PK1, hash);
        sigs[1] = _sign(PK2, hash);

        bridge.releaseMultisig(id, user, nonce, sigs);

        assertEq(bridge.getDeposit(id).status, 2);
        assertTrue(bridge.usedWithdrawalNonces(nonce));
    }

    function test_release_with_three_signatures_uses_first_two() public {
        uint256 id = _deposit(5 * ONE_USDC);
        bytes32 nonce = keccak256("nonce-2");
        bytes32 hash  = _releaseHash(id, user, nonce);

        bytes[] memory sigs = new bytes[](3);
        sigs[0] = _sign(PK1, hash);
        sigs[1] = _sign(PK2, hash);
        sigs[2] = _sign(PK3, hash);

        bridge.releaseMultisig(id, user, nonce, sigs);
        assertEq(bridge.getDeposit(id).status, 2);
    }

    function test_release_fails_with_one_signature() public {
        uint256 id = _deposit(10 * ONE_USDC);
        bytes32 nonce = keccak256("nonce-3");
        bytes32 hash  = _releaseHash(id, user, nonce);

        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sign(PK1, hash);

        vm.expectRevert("not enough signatures provided");
        bridge.releaseMultisig(id, user, nonce, sigs);
    }

    function test_release_fails_with_duplicate_signatures() public {
        uint256 id = _deposit(10 * ONE_USDC);
        bytes32 nonce = keccak256("nonce-4");
        bytes32 hash  = _releaseHash(id, user, nonce);

        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(PK1, hash);
        sigs[1] = _sign(PK1, hash); // same signer twice

        vm.expectRevert("insufficient valid signatures");
        bridge.releaseMultisig(id, user, nonce, sigs);
    }

    function test_release_fails_with_non_relayer_signature() public {
        uint256 id = _deposit(10 * ONE_USDC);
        bytes32 nonce = keccak256("nonce-5");
        bytes32 hash  = _releaseHash(id, user, nonce);

        uint256 pkRogue = 0xBAD;
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(PK1, hash);
        sigs[1] = _sign(pkRogue, hash); // not a relayer

        vm.expectRevert("insufficient valid signatures");
        bridge.releaseMultisig(id, user, nonce, sigs);
    }

    function test_replay_attack_blocked() public {
        uint256 id = _deposit(10 * ONE_USDC);
        bytes32 nonce = keccak256("nonce-6");
        bytes32 hash  = _releaseHash(id, user, nonce);

        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(PK1, hash);
        sigs[1] = _sign(PK2, hash);

        bridge.releaseMultisig(id, user, nonce, sigs);

        // Try again with same nonce
        vm.expectRevert("nonce already used");
        bridge.releaseMultisig(id, user, nonce, sigs);
    }

    function test_add_and_remove_signer() public {
        address newSigner = makeAddr("signer4");

        vm.prank(owner);
        bridge.addSigner(newSigner);
        assertEq(bridge.getSigners().length, 4);

        vm.prank(owner);
        bridge.removeSigner(newSigner);
        assertEq(bridge.getSigners().length, 3);
    }

    function test_cannot_remove_signer_below_threshold() public {
        // threshold=2, signers=3 → can remove 1
        vm.prank(owner);
        bridge.removeSigner(relayer3);

        // threshold=2, signers=2 → cannot remove more
        vm.prank(owner);
        vm.expectRevert("would break threshold");
        bridge.removeSigner(relayer2);
    }

    function test_set_threshold() public {
        vm.prank(owner);
        bridge.setThreshold(3); // raise to 3-of-3
        assertEq(bridge.threshold(), 3);

        // Now 2 sigs should fail
        uint256 id = _deposit(10 * ONE_USDC);
        bytes32 nonce = keccak256("nonce-7");
        bytes32 hash  = _releaseHash(id, user, nonce);

        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(PK1, hash);
        sigs[1] = _sign(PK2, hash);

        vm.expectRevert("not enough signatures provided");
        bridge.releaseMultisig(id, user, nonce, sigs);
    }

    function test_releaseHash_helper() public view {
        // releaseHash() returns raw payload (before personal_sign prefix).
        // _releaseHash() returns the full msgHash (with prefix) used in ecrecover.
        bytes32 rawPayload = bridge.releaseHash(0, user, keccak256("n"));
        bytes32 msgHash    = _releaseHash(0, user, keccak256("n"));
        // They should differ — one has the prefix, the other doesn't.
        // What we check: msgHash = keccak256("\x19...32" || rawPayload)
        bytes32 expected = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", rawPayload)
        );
        assertEq(msgHash, expected);
    }

    function test_non_owner_cannot_add_signer() public {
        vm.prank(user);
        vm.expectRevert("not owner");
        bridge.addSigner(makeAddr("x"));
    }
}
