//! Content hashing, kept byte-for-byte identical to the server's
//! `FileService::hash_bytes` so a file that is equal on two machines yields the
//! same hash and reconciles as unchanged.

use sha2::{Digest, Sha256};
use std::path::Path;

/// Lowercase-hex SHA-256 of `bytes`.
pub fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Hash a file's raw bytes.
pub fn hash_file(path: &Path) -> std::io::Result<String> {
    let bytes = std::fs::read(path)?;
    Ok(hash_bytes(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_and_known_vectors() {
        // SHA-256 of the empty input.
        assert_eq!(
            hash_bytes(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        // SHA-256 of "abc".
        assert_eq!(
            hash_bytes(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
