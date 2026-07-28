//! Re-exports the `librarium-types` DTOs that `file_service` returns, under
//! the same `crate::models::{...}` path `librarium-server`'s own (larger)
//! `models` module uses — so `file_service.rs` needed no import changes when
//! it moved into this crate.

pub use librarium_types::{FileContent, FileManifestEntry, FileNode};
