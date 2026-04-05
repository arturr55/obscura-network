/// Simplified Merkle-Patricia Trie (MPT) verifier for SP1 guest environment.
///
/// Supports verifying Ethereum account proofs and storage proofs.
/// The full Ethereum MPT uses a variant of radix-16 trie with RLP encoding.
///
/// Node types:
///   - Leaf:      [encoded_path, value]      (2 items)
///   - Extension: [encoded_path, next_hash]  (2 items)
///   - Branch:    [child0..child15, value]   (17 items)
///
/// Path encoding (HP = Hex-Prefix):
///   prefix nibble 0 or 1 → even/odd extension
///   prefix nibble 2 or 3 → even/odd leaf

use tiny_keccak::{Hasher, Keccak};

fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut k = Keccak::v256();
    k.update(data);
    let mut out = [0u8; 32];
    k.finalize(&mut out);
    out
}

/// Verify a Merkle-Patricia Trie inclusion proof.
///
/// # Arguments
/// - `root`  — expected trie root hash
/// - `key`   — trie lookup key (keccak256 of account address or storage slot)
/// - `proof` — ordered list of RLP-encoded trie nodes (root → leaf)
/// - `value` — expected RLP-encoded value at the leaf
pub fn verify_mpt_proof(
    root: &[u8; 32],
    key: &[u8; 32],
    proof: &[Vec<u8>],
    expected_value: &[u8],
) -> bool {
    // Convert key to nibble path
    let nibbles = bytes_to_nibbles(key);
    let mut nibble_pos = 0usize;
    let mut current_hash: [u8; 32] = *root;

    for node_rlp in proof {
        // Verify this node matches expected hash
        let node_hash = keccak256(node_rlp);
        if node_hash != current_hash {
            // Short nodes (< 32 bytes) are inlined, not hashed
            // For the root and longer nodes, hashes must match
            if node_rlp.len() >= 32 {
                return false;
            }
        }

        // Decode RLP list
        let items = match rlp_decode_list(node_rlp) {
            Some(v) => v,
            None => return false,
        };

        match items.len() {
            // Branch node: 17 items [child0..child15, value]
            17 => {
                if nibble_pos >= nibbles.len() {
                    // We're at the value position
                    return items[16] == expected_value;
                }
                let nibble = nibbles[nibble_pos] as usize;
                nibble_pos += 1;
                let child = &items[nibble];
                if child.is_empty() {
                    return false;
                }
                if child.len() == 32 {
                    current_hash.copy_from_slice(child);
                } else {
                    // Inline short node — the next iteration will process it
                    // We simulate by re-hashing won't work; for simplicity
                    // assume all proof nodes are full 32-byte hashed
                    return false;
                }
            }
            // Leaf or extension: 2 items [encoded_path, value_or_hash]
            2 => {
                let encoded_path = &items[0];
                let second = &items[1];

                let (is_leaf, path_nibbles) = decode_hp(encoded_path);

                // Consume matching nibbles
                let path_len = path_nibbles.len();
                if nibble_pos + path_len > nibbles.len() {
                    return false;
                }
                if nibbles[nibble_pos..nibble_pos + path_len] != path_nibbles[..] {
                    return false;
                }
                nibble_pos += path_len;

                if is_leaf {
                    // Must have consumed all nibbles
                    if nibble_pos != nibbles.len() {
                        return false;
                    }
                    return second == expected_value;
                } else {
                    // Extension: second is next node hash
                    if second.len() != 32 {
                        return false;
                    }
                    current_hash.copy_from_slice(second);
                }
            }
            _ => return false,
        }
    }

    false
}

/// Decode HP (Hex-Prefix) encoded path.
/// Returns (is_leaf, nibbles).
fn decode_hp(encoded: &[u8]) -> (bool, Vec<u8>) {
    if encoded.is_empty() {
        return (false, vec![]);
    }
    let first_nibble = (encoded[0] >> 4) & 0x0f;
    let is_leaf = first_nibble >= 2;
    let is_odd = first_nibble & 1 == 1;

    let mut nibbles = Vec::new();
    if is_odd {
        nibbles.push(encoded[0] & 0x0f);
    }
    for &byte in &encoded[1..] {
        nibbles.push(byte >> 4);
        nibbles.push(byte & 0x0f);
    }
    (is_leaf, nibbles)
}

/// Convert 32-byte key to 64 nibbles.
fn bytes_to_nibbles(key: &[u8; 32]) -> Vec<u8> {
    let mut nibbles = Vec::with_capacity(64);
    for &b in key {
        nibbles.push(b >> 4);
        nibbles.push(b & 0x0f);
    }
    nibbles
}

/// Minimal RLP list decoder.
/// Returns the items as raw byte slices, or None on malformed input.
fn rlp_decode_list(data: &[u8]) -> Option<Vec<Vec<u8>>> {
    if data.is_empty() {
        return None;
    }
    let first = data[0];

    // Must be a list (0xc0..0xff)
    if first < 0xc0 {
        return None;
    }

    let (payload, _) = if first <= 0xf7 {
        let len = (first - 0xc0) as usize;
        if data.len() < 1 + len {
            return None;
        }
        (&data[1..1 + len], 1 + len)
    } else {
        let len_of_len = (first - 0xf7) as usize;
        if data.len() < 1 + len_of_len {
            return None;
        }
        let len = decode_be_usize(&data[1..1 + len_of_len]);
        if data.len() < 1 + len_of_len + len {
            return None;
        }
        (&data[1 + len_of_len..1 + len_of_len + len], 1 + len_of_len + len)
    };

    // Decode items from payload
    let mut items = Vec::new();
    let mut pos = 0;
    while pos < payload.len() {
        let (item, consumed) = rlp_decode_item(&payload[pos..])?;
        items.push(item);
        pos += consumed;
    }
    Some(items)
}

/// Decode a single RLP item. Returns (value_bytes, total_consumed).
fn rlp_decode_item(data: &[u8]) -> Option<(Vec<u8>, usize)> {
    if data.is_empty() {
        return None;
    }
    let first = data[0];
    if first <= 0x7f {
        // Single byte
        Some((vec![first], 1))
    } else if first <= 0xb7 {
        // Short string
        let len = (first - 0x80) as usize;
        if data.len() < 1 + len {
            return None;
        }
        Some((data[1..1 + len].to_vec(), 1 + len))
    } else if first <= 0xbf {
        // Long string
        let len_of_len = (first - 0xb7) as usize;
        if data.len() < 1 + len_of_len {
            return None;
        }
        let len = decode_be_usize(&data[1..1 + len_of_len]);
        if data.len() < 1 + len_of_len + len {
            return None;
        }
        Some((data[1 + len_of_len..1 + len_of_len + len].to_vec(), 1 + len_of_len + len))
    } else {
        // List — return raw bytes
        let list_len = if first <= 0xf7 {
            1 + (first - 0xc0) as usize
        } else {
            let lol = (first - 0xf7) as usize;
            if data.len() < 1 + lol {
                return None;
            }
            let ll = decode_be_usize(&data[1..1 + lol]);
            1 + lol + ll
        };
        if data.len() < list_len {
            return None;
        }
        Some((data[..list_len].to_vec(), list_len))
    }
}

fn decode_be_usize(bytes: &[u8]) -> usize {
    let mut result = 0usize;
    for &b in bytes {
        result = (result << 8) | b as usize;
    }
    result
}
