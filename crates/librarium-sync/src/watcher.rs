//! A dedicated filesystem watcher for the sync engine.
//!
//! It is intentionally separate from the embedded server's watcher: it owns its
//! own content hashing and a feedback-loop suppressor so that files the engine
//! writes locally (during a pull) are not immediately re-detected and pushed
//! back. Each watcher instance follows one vault directory and emits
//! [`LocalChange`] values with the new content hash already computed.

use crate::hash::hash_file;
use notify::event::{ModifyKind, RenameMode};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tracing::{error, warn};

/// How long a suppression entry stays valid. Long enough to cover the debounce
/// window plus filesystem latency, short enough that a genuine later edit to the
/// same content is not swallowed.
const SUPPRESS_TTL: Duration = Duration::from_secs(10);

/// A local filesystem change, with the resulting content hash for upserts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocalChange {
    /// A file was created or modified; carries its new content hash.
    Upserted { path: String, hash: String },
    /// A file was removed.
    Deleted { path: String },
}

/// Breaks the write→detect→re-push feedback loop.
///
/// Before the engine writes a file locally it records the `(path, expected
/// hash)` here. When the watcher later observes that path with a matching hash,
/// the event is dropped. Matching on the hash (not just the path) means a real
/// user edit that happens to land during the window is still detected, because
/// its hash differs from the one the engine wrote.
#[derive(Clone, Default)]
pub struct Suppressor {
    inner: Arc<Mutex<HashMap<String, SuppressEntry>>>,
}

struct SuppressEntry {
    hash: String,
    expires: Instant,
}

impl Suppressor {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record that the engine is about to write `hash` to `path`, so the
    /// resulting watcher event should be ignored.
    pub fn suppress(&self, path: &str, hash: &str) {
        if let Ok(mut map) = self.inner.lock() {
            map.insert(
                path.to_string(),
                SuppressEntry {
                    hash: hash.to_string(),
                    expires: Instant::now() + SUPPRESS_TTL,
                },
            );
        }
    }

    /// Returns true if `(path, hash)` was suppressed. Consumes the entry on a
    /// match and prunes anything expired.
    fn take(&self, path: &str, hash: &str) -> bool {
        let Ok(mut map) = self.inner.lock() else {
            return false;
        };
        let now = Instant::now();
        map.retain(|_, e| e.expires > now);
        match map.get(path) {
            Some(entry) if entry.hash == hash => {
                map.remove(path);
                true
            }
            _ => false,
        }
    }
}

/// An active watcher. Dropping it stops the watch.
pub struct LocalWatcher {
    _debouncer: Debouncer<RecommendedWatcher, RecommendedCache>,
}

impl LocalWatcher {
    /// Start watching `vault_path` recursively. Emitted [`LocalChange`]s are sent
    /// on `tx`; events matching a suppression entry are dropped.
    pub fn start(
        vault_path: PathBuf,
        suppressor: Suppressor,
        tx: mpsc::UnboundedSender<LocalChange>,
    ) -> Result<Self, notify::Error> {
        let root = vault_path.clone();
        let mut debouncer = new_debouncer(
            Duration::from_millis(500),
            None,
            move |result: DebounceEventResult| match result {
                Ok(events) => {
                    for event in events {
                        handle_event(event.event, &root, &suppressor, &tx);
                    }
                }
                Err(errors) => {
                    for e in errors {
                        error!("sync watch error: {e:?}");
                    }
                }
            },
        )?;
        debouncer.watch(&vault_path, RecursiveMode::Recursive)?;
        Ok(Self {
            _debouncer: debouncer,
        })
    }
}

fn emit(
    suppressor: &Suppressor,
    tx: &mpsc::UnboundedSender<LocalChange>,
    root: &Path,
    abs_path: &Path,
    deleted: bool,
) {
    let path = rel(root, abs_path);
    // Ignore dot-entries by inspecting only the vault-relative path, so a vault
    // that happens to live under a hidden/temp parent directory still syncs.
    if is_ignored(&path) {
        return;
    }
    let change = if deleted || !abs_path.is_file() {
        LocalChange::Deleted { path }
    } else {
        match hash_file(abs_path) {
            Ok(hash) => {
                if suppressor.take(&path, &hash) {
                    return;
                }
                LocalChange::Upserted { path, hash }
            }
            Err(e) => {
                warn!("sync watcher failed to hash {path}: {e}");
                return;
            }
        }
    };
    let _ = tx.send(change);
}

fn handle_event(
    event: Event,
    root: &Path,
    suppressor: &Suppressor,
    tx: &mpsc::UnboundedSender<LocalChange>,
) {
    if event.paths.is_empty() {
        return;
    }

    // A Rename(Both) carries [from, to]; decompose into a delete of the old path
    // and an upsert of the new one so the reconciler treats it as content moving.
    if let EventKind::Modify(ModifyKind::Name(RenameMode::Both)) = event.kind {
        if event.paths.len() >= 2 {
            emit(suppressor, tx, root, &event.paths[0], true);
            emit(suppressor, tx, root, &event.paths[1], false);
            return;
        }
    }

    for abs_path in &event.paths {
        if !abs_path.starts_with(root) {
            continue;
        }
        let deleted = match event.kind {
            EventKind::Create(_) => false,
            EventKind::Remove(_) => true,
            EventKind::Modify(ModifyKind::Name(RenameMode::From)) => true,
            EventKind::Modify(ModifyKind::Name(RenameMode::To)) => false,
            EventKind::Modify(ModifyKind::Name(RenameMode::Any)) => !abs_path.exists(),
            EventKind::Modify(_) => false,
            _ => continue,
        };
        emit(suppressor, tx, root, abs_path, deleted);
    }
}

/// Skip any dotfile or dot-directory in the vault-relative path (covers
/// `.obsidian/`, `.trash/`, `.git/`, etc.), matching the server's ignore rule.
fn is_ignored(rel_path: &str) -> bool {
    rel_path.split('/').any(|seg| seg.starts_with('.'))
}

/// Vault-relative path with forward slashes, matching the server convention.
fn rel(vault_path: &Path, abs_path: &Path) -> String {
    abs_path
        .strip_prefix(vault_path)
        .unwrap_or(abs_path)
        .to_string_lossy()
        .replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suppressor_matches_on_hash_only() {
        let s = Suppressor::new();
        s.suppress("a.md", "h1");
        // Wrong hash -> not suppressed (a real edit slipped in).
        assert!(!s.take("a.md", "h2"));
        // Correct hash -> suppressed, and consumed.
        assert!(s.take("a.md", "h1"));
        assert!(!s.take("a.md", "h1"));
    }
}
