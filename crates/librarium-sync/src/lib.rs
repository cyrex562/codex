//! Continuous background file sync between a local (desktop-embedded) Librarium
//! server and a remote Librarium server.
//!
//! The remote server is the hub / source of truth. Each mapped local vault is a
//! replica: local changes are pushed to the remote and remote changes are pulled
//! down, reconciled through the pure three-way [`reconcile`](reconcile::reconcile)
//! core. Divergent edits are resolved keep-both (a `conflict_*` sibling), so no
//! edit is ever lost.
//!
//! Layers:
//! - [`reconcile`] — the pure decision core (fully unit-tested).
//! - [`state`] — durable `sync.db`: cursors, per-path merge base, outbox.
//! - [`watcher`] — a dedicated FS watcher with feedback-loop suppression.
//! - [`engine`] — the online/offline orchestration that ties it together.

pub mod engine;
pub mod hash;
pub mod reconcile;
pub mod state;
pub mod watcher;

pub use engine::{SyncEngine, VaultStatus, VaultSyncState};
pub use state::{OutboxOp, RemoteRecord, SyncStore, VaultMap};

/// Errors surfaced by the sync engine.
#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error("remote client error: {0}")]
    Client(#[from] librarium_client::ClientError),
    #[error("sync database error: {0}")]
    Sqlx(#[from] sqlx::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("watch error: {0}")]
    Watch(String),
    #[error("state error: {0}")]
    State(String),
}
