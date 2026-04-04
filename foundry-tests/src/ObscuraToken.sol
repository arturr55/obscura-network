// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ObscuraToken (OBSCURA)
 * @notice ERC-20 governance and utility token for Obscura Network.
 *
 * Use cases:
 * - Governance: vote on protocol parameters (fees, upgrades)
 * - Staking: validators lock OBSCURA to participate in consensus
 * - Discount: holding OBSCURA gives 40% discount on subscription fees
 *
 * Supply: 1,000,000,000 OBSCURA (1 billion)
 * Distribution:
 *   - 150,000,000 (15%) → team (vested 4 years, 1 year cliff)
 *   - 150,000,000 (15%) → investors / grants
 *   - 300,000,000 (30%) → ecosystem / developer grants
 *   - 250,000,000 (25%) → treasury
 *   - 150,000,000 (15%) → airdrop to early users
 */
contract ObscuraToken {
    // ── ERC-20 standard ──────────────────────────────────────────────────

    string public constant name     = "Obscura Network";
    string public constant symbol   = "OBSCURA";
    uint8  public constant decimals = 18;
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 10**18;

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    uint256 private _totalSupply;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ── Ownership ─────────────────────────────────────────────────────────

    address public owner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "OBSCURA: not owner");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────

    constructor(address treasury) {
        owner = msg.sender;
        // Mint all tokens to treasury — distribution handled off-chain or
        // via separate vesting/airdrop contracts
        _mint(treasury, TOTAL_SUPPLY);
    }

    // ── ERC-20 interface ──────────────────────────────────────────────────

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function allowance(address tokenOwner, address spender) external view returns (uint256) {
        return _allowances[tokenOwner][spender];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 currentAllowance = _allowances[from][msg.sender];
        require(currentAllowance >= amount, "OBSCURA: insufficient allowance");
        _approve(from, msg.sender, currentAllowance - amount);
        _transfer(from, to, amount);
        return true;
    }

    // ── Owner functions ───────────────────────────────────────────────────

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "OBSCURA: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ── Internal ──────────────────────────────────────────────────────────

    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0), "OBSCURA: transfer from zero");
        require(to   != address(0), "OBSCURA: transfer to zero");
        require(_balances[from] >= amount, "OBSCURA: insufficient balance");
        _balances[from] -= amount;
        _balances[to]   += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "OBSCURA: mint to zero");
        _totalSupply    += amount;
        _balances[to]   += amount;
        emit Transfer(address(0), to, amount);
    }

    function _approve(address tokenOwner, address spender, uint256 amount) internal {
        require(tokenOwner != address(0), "OBSCURA: approve from zero");
        require(spender    != address(0), "OBSCURA: approve to zero");
        _allowances[tokenOwner][spender] = amount;
        emit Approval(tokenOwner, spender, amount);
    }
}
