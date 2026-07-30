//! The sync orchestration: per-vault tasks that push local changes and pull
//! remote changes, staying live over a WebSocket and healing drift periodically.
//!
//! One [`SyncEngine`] owns the shared [`SyncStore`] and spawns one background
//! task per (remote, mapped vault). Each task:
//!  1. reconciles fully against the remote manifest (initial sync / drift repair),
//!  2. drains the durable outbox (pending local pushes),
//!  3. catches up via the `seq` cursor,
//!  4. then stays live on the WebSocket, and
//!  5. re-runs the above on reconnect, with exponential backoff.

use crate::hash::{hash_bytes, hash_file};
use crate::reconcile::{reconcile, Action, ConflictWinner, Decision};
use crate::state::{OutboxOp, RemoteRecord, SyncStore, VaultMap};
use crate::watcher::{LocalChange, LocalWatcher, Suppressor};
use crate::SyncError;
use futures_util::StreamExt;
use librarium_client::ObsidianClient;
use librarium_types::WsMessage;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tracing::{info, warn};

/// Coarse lifecycle state of a vault's sync task.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VaultSyncState {
    Offline,
    Connecting,
    /// Doing the initial/full reconcile (pushing and pulling files). This can be
    /// long for a large vault, so progress is reported via `synced`/`total`.
    Syncing,
    CatchingUp,
    Live,
}

/// A snapshot of a vault's sync status, surfaced to the desktop UI.
#[derive(Debug, Clone, serde::Serialize)]
pub struct VaultStatus {
    pub remote_id: String,
    pub local_vault_id: String,
    pub state: VaultSyncState,
    pub last_synced_seq: i64,
    pub pending_outbox: i64,
    pub last_error: Option<String>,
    /// Files processed so far in the current reconcile pass.
    pub synced: i64,
    /// Total files to process in the current reconcile pass (0 when idle).
    pub total: i64,
}

type StatusMap = Arc<Mutex<HashMap<(String, String), VaultStatus>>>;

/// Supplies a remote's API key at connection time, so the engine never needs
/// to persist the secret itself (`sync.db` holds only `id`/`base_url`/
/// `enabled` — see [`RemoteRecord`]). The closure may block (e.g. querying an
/// OS keyring); the engine always calls it via `spawn_blocking`.
pub type ApiKeyProvider = Arc<dyn Fn(&str) -> Option<String> + Send + Sync>;

/// Run `provider` in a blocking task and turn a missing key into a proper
/// error, so every call site gets the same "why can't we connect" message.
async fn fetch_api_key(provider: &ApiKeyProvider, remote_id: &str) -> Result<String, SyncError> {
    let provider = provider.clone();
    let owned_id = remote_id.to_string();
    let key = tokio::task::spawn_blocking(move || provider(&owned_id))
        .await
        .map_err(|e| SyncError::State(format!("key provider task join error: {e}")))?;
    key.ok_or_else(|| SyncError::State(format!("no api key available for remote: {remote_id}")))
}

/// The public entry point. Holds the shared state store and running tasks.
pub struct SyncEngine {
    store: SyncStore,
    tasks: Mutex<Vec<JoinHandle<()>>>,
    status: StatusMap,
    key_provider: ApiKeyProvider,
}

impl SyncEngine {
    /// Open (creating if needed) the sync state database at `db_path`.
    /// `key_provider` supplies each remote's API key on demand (see
    /// [`ApiKeyProvider`]).
    pub async fn open(db_path: &Path, key_provider: ApiKeyProvider) -> Result<Self, SyncError> {
        Ok(Self {
            store: SyncStore::open(db_path).await?,
            tasks: Mutex::new(Vec::new()),
            status: Arc::new(Mutex::new(HashMap::new())),
            key_provider,
        })
    }

    /// Register (or update) a remote server. Returns its id. The API key
    /// itself is not passed here — the caller is expected to have already
    /// stored it wherever its [`ApiKeyProvider`] will read it from.
    pub async fn add_remote(&self, id: String, base_url: String) -> Result<String, SyncError> {
        self.store
            .upsert_remote(&RemoteRecord {
                id: id.clone(),
                base_url,
                enabled: true,
            })
            .await?;
        Ok(id)
    }

    /// Map a local vault to a remote vault under a remote.
    pub async fn map_vault(
        &self,
        remote_id: String,
        local_vault_id: String,
        local_vault_path: String,
        remote_vault_id: String,
    ) -> Result<(), SyncError> {
        self.store
            .upsert_vault_map(&VaultMap {
                remote_id,
                local_vault_id,
                local_vault_path,
                remote_vault_id,
                last_synced_seq: 0,
            })
            .await
    }

    pub async fn list_remotes(&self) -> Result<Vec<RemoteRecord>, SyncError> {
        self.store.list_remotes().await
    }

    /// Build the client for a configured remote, looking it up by id.
    async fn client_for_remote(&self, remote_id: &str) -> Result<ObsidianClient, SyncError> {
        let remotes = self.store.list_remotes().await?;
        let remote = remotes
            .into_iter()
            .find(|r| r.id == remote_id)
            .ok_or_else(|| SyncError::State(format!("unknown remote: {remote_id}")))?;
        let api_key = fetch_api_key(&self.key_provider, &remote.id).await?;
        Ok(ObsidianClient::for_cloud(remote.base_url).with_api_key(api_key))
    }

    /// List the vaults available on a remote server.
    pub async fn list_remote_vaults(
        &self,
        remote_id: &str,
    ) -> Result<Vec<librarium_types::Vault>, SyncError> {
        let client = self.client_for_remote(remote_id).await?;
        Ok(client.list_vaults().await?)
    }

    /// Create a new vault on a remote server.
    pub async fn create_remote_vault(
        &self,
        remote_id: &str,
        name: &str,
    ) -> Result<librarium_types::Vault, SyncError> {
        let client = self.client_for_remote(remote_id).await?;
        Ok(client
            .create_vault(&librarium_types::CreateVaultRequest {
                name: name.to_string(),
                path: None,
            })
            .await?)
    }

    /// Remove a remote and everything mapped to it.
    pub async fn remove_remote(&self, remote_id: &str) -> Result<(), SyncError> {
        self.store.delete_remote(remote_id).await
    }

    /// Remove a single local-to-remote vault mapping.
    pub async fn unmap_vault(
        &self,
        remote_id: &str,
        local_vault_id: &str,
    ) -> Result<(), SyncError> {
        self.store.delete_vault_map(remote_id, local_vault_id).await
    }

    /// Spawn background sync tasks for every enabled remote + mapped vault.
    /// Idempotent-ish: call [`Self::stop`] first to avoid duplicate tasks.
    pub async fn start(&self) -> Result<(), SyncError> {
        let remotes = self.store.list_remotes().await?;
        let mut handles = Vec::new();
        for remote in remotes.into_iter().filter(|r| r.enabled) {
            let maps = self.store.list_vault_maps(&remote.id).await?;
            for map in maps {
                let ctx = TaskContext {
                    store: self.store.clone(),
                    remote: remote.clone(),
                    map,
                    status: self.status.clone(),
                    key_provider: self.key_provider.clone(),
                };
                handles.push(tokio::spawn(async move { ctx.run().await }));
            }
        }
        if let Ok(mut tasks) = self.tasks.lock() {
            tasks.extend(handles);
        }
        Ok(())
    }

    /// Abort all running sync tasks.
    pub fn stop(&self) {
        if let Ok(mut tasks) = self.tasks.lock() {
            for t in tasks.drain(..) {
                t.abort();
            }
        }
    }

    /// Current per-vault status snapshots.
    pub fn status(&self) -> Vec<VaultStatus> {
        self.status
            .lock()
            .map(|m| m.values().cloned().collect())
            .unwrap_or_default()
    }
}

impl Drop for SyncEngine {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Everything one vault task needs to run its reconnect loop.
struct TaskContext {
    store: SyncStore,
    remote: RemoteRecord,
    map: VaultMap,
    status: StatusMap,
    key_provider: ApiKeyProvider,
}

impl TaskContext {
    async fn run(self) {
        let key = (self.remote.id.clone(), self.map.local_vault_id.clone());
        let api_key = match fetch_api_key(&self.key_provider, &self.remote.id).await {
            Ok(k) => k,
            Err(e) => {
                self.set_status(&key, VaultSyncState::Offline, Some(format!("api key: {e}")));
                warn!(
                    "sync: no api key available for remote {}: {e}",
                    self.remote.id
                );
                return;
            }
        };
        let client = ObsidianClient::for_cloud(self.remote.base_url.clone()).with_api_key(api_key);

        // The local watcher lives for the whole task, across reconnects.
        let suppressor = Suppressor::new();
        let (local_tx, local_rx) = mpsc::unbounded_channel();
        let _watcher = match LocalWatcher::start(
            PathBuf::from(&self.map.local_vault_path),
            suppressor.clone(),
            local_tx,
        ) {
            Ok(w) => w,
            Err(e) => {
                self.set_status(&key, VaultSyncState::Offline, Some(format!("watch: {e}")));
                warn!(
                    "sync: failed to start watcher for {}: {e}",
                    self.map.local_vault_path
                );
                return;
            }
        };

        let last_seq = self
            .store
            .list_vault_maps(&self.remote.id)
            .await
            .ok()
            .and_then(|maps| {
                maps.into_iter()
                    .find(|m| m.local_vault_id == self.map.local_vault_id)
                    .map(|m| m.last_synced_seq)
            })
            .unwrap_or(0);

        let mut vault = VaultSync {
            store: self.store.clone(),
            client,
            remote_id: self.remote.id.clone(),
            local_vault_id: self.map.local_vault_id.clone(),
            local_vault_path: PathBuf::from(&self.map.local_vault_path),
            remote_vault_id: self.map.remote_vault_id.clone(),
            suppressor,
            local_rx,
            remote_hashes: HashMap::new(),
            last_seq,
            status: self.status.clone(),
            status_key: key.clone(),
        };

        // Reconnect loop with exponential backoff (jitter-free; the sleep is
        // varied only by the doubling, which is fine for a single desktop link).
        let mut backoff = Duration::from_secs(1);
        let max_backoff = Duration::from_secs(30);
        loop {
            match vault.connect_and_run().await {
                Ok(()) => {
                    // Clean WS close — reconnect promptly.
                    backoff = Duration::from_secs(1);
                }
                Err(e) => {
                    vault.set_state(VaultSyncState::Offline, Some(e.to_string()));
                    warn!("sync vault {} offline: {e}", vault.local_vault_id);
                    tokio::time::sleep(backoff).await;
                    backoff = (backoff * 2).min(max_backoff);
                }
            }
        }
    }

    fn set_status(&self, key: &(String, String), state: VaultSyncState, err: Option<String>) {
        if let Ok(mut m) = self.status.lock() {
            m.insert(
                key.clone(),
                VaultStatus {
                    remote_id: key.0.clone(),
                    local_vault_id: key.1.clone(),
                    state,
                    last_synced_seq: 0,
                    pending_outbox: 0,
                    last_error: err,
                    synced: 0,
                    total: 0,
                },
            );
        }
    }
}

/// The mutable working state for one vault's sync.
struct VaultSync {
    store: SyncStore,
    client: ObsidianClient,
    remote_id: String,
    local_vault_id: String,
    local_vault_path: PathBuf,
    remote_vault_id: String,
    suppressor: Suppressor,
    local_rx: mpsc::UnboundedReceiver<LocalChange>,
    /// Best-known remote content hash per path (absent from the map = unknown /
    /// not present remotely).
    remote_hashes: HashMap<String, String>,
    last_seq: i64,
    status: StatusMap,
    status_key: (String, String),
}

impl VaultSync {
    /// One connection lifetime: full reconcile, drain outbox, catch up, then
    /// stay live until the socket closes or an error occurs.
    async fn connect_and_run(&mut self) -> Result<(), SyncError> {
        self.set_state(VaultSyncState::Connecting, None);

        // The full reconcile (manifest + initial push/pull) is the long phase for
        // a large vault, so report it as Syncing with file progress rather than
        // leaving the UI stuck on "connecting".
        self.set_state(VaultSyncState::Syncing, None);
        self.full_reconcile().await?;
        self.drain_outbox().await?;
        self.set_state(VaultSyncState::CatchingUp, None);
        self.pull_changes().await?;

        let mut ws = self.client.connect_ws().await?;
        self.set_state(VaultSyncState::Live, None);
        info!("sync vault {} live", self.local_vault_id);

        // Periodic drift repair heals anything missed while the WS was quiet or
        // pruned past the server's change-log retention.
        let mut drift = tokio::time::interval(Duration::from_secs(3600));
        drift.tick().await; // consume the immediate first tick

        loop {
            tokio::select! {
                // Remote pushed something.
                frame = ws.next() => {
                    match frame {
                        Some(Ok(msg)) => {
                            if self.handle_ws_frame(msg).await? {
                                self.pull_changes().await?;
                            }
                        }
                        Some(Err(e)) => return Err(SyncError::Client(e.into())),
                        None => return Ok(()), // socket closed cleanly
                    }
                }
                // Local files changed.
                local = self.local_rx.recv() => {
                    match local {
                        Some(change) => {
                            self.enqueue_local(change).await?;
                            // Refresh remote view first to narrow the race, then push.
                            self.pull_changes().await?;
                            self.drain_outbox().await?;
                        }
                        None => return Ok(()), // watcher dropped
                    }
                }
                _ = drift.tick() => {
                    self.full_reconcile().await?;
                    self.drain_outbox().await?;
                }
            }
        }
    }

    /// Returns true when the frame indicates this vault changed remotely and a
    /// pull should run.
    async fn handle_ws_frame(
        &mut self,
        msg: tokio_tungstenite::tungstenite::Message,
    ) -> Result<bool, SyncError> {
        use tokio_tungstenite::tungstenite::Message;
        let text = match msg {
            Message::Text(t) => t,
            Message::Close(_) => return Ok(false),
            _ => return Ok(false),
        };
        let Ok(parsed) = serde_json::from_str::<WsMessage>(&text) else {
            return Ok(false);
        };
        Ok(matches!(
            parsed,
            WsMessage::FileChanged { vault_id, .. } if vault_id == self.remote_vault_id
        ))
    }

    // ── Reconciliation entry points ─────────────────────────────────────────

    /// Reconcile the whole vault against the remote manifest. Covers the initial
    /// sync and periodic drift repair. Also seeds `remote_hashes`.
    async fn full_reconcile(&mut self) -> Result<(), SyncError> {
        let manifest = {
            let client = self.client.clone();
            let vault = self.remote_vault_id.clone();
            with_retry("manifest", move || {
                let client = client.clone();
                let vault = vault.clone();
                async move { client.get_manifest(&vault).await }
            })
            .await?
        };
        self.remote_hashes = manifest
            .iter()
            .map(|e| (e.path.clone(), e.content_hash.clone()))
            .collect();

        // The union of every path that could need action: remote files, local
        // files, and paths we have a recorded base for (to catch deletes).
        let mut paths: HashSet<String> = self.remote_hashes.keys().cloned().collect();
        paths.extend(local_file_paths(&self.local_vault_path));
        paths.extend(
            self.store
                .known_paths(&self.remote_id, &self.local_vault_id)
                .await?,
        );

        let total = paths.len() as i64;
        self.set_progress(0, total);
        for (i, path) in paths.into_iter().enumerate() {
            self.reconcile_path(&path).await?;
            // Update the counter periodically (and on the last item) to keep the
            // status panel moving without locking on every single file.
            let done = (i + 1) as i64;
            if done % 20 == 0 || done == total {
                self.set_progress(done, total);
            }
        }
        self.refresh_status().await;
        Ok(())
    }

    /// Pull and apply remote changes since our seq cursor, advancing it.
    async fn pull_changes(&mut self) -> Result<(), SyncError> {
        loop {
            let page = {
                let client = self.client.clone();
                let vault = self.remote_vault_id.clone();
                let since = self.last_seq;
                with_retry("changes", move || {
                    let client = client.clone();
                    let vault = vault.clone();
                    async move { client.get_changes_since_seq(&vault, since).await }
                })
                .await?
            };

            for entry in &page.events {
                // Update our remote view from the log entry, then reconcile.
                match entry.content_hash.clone() {
                    Some(h) => {
                        self.remote_hashes.insert(entry.path.clone(), h);
                    }
                    None => {
                        self.remote_hashes.remove(&entry.path);
                    }
                }
                self.reconcile_path(&entry.path).await?;
            }

            let advanced = page.head_seq > self.last_seq;
            self.last_seq = page.head_seq.max(self.last_seq);
            self.store
                .set_last_synced_seq(&self.remote_id, &self.local_vault_id, self.last_seq)
                .await?;

            // Empty page or fully caught up: stop.
            if page.events.is_empty() || !advanced {
                break;
            }
        }
        self.refresh_status().await;
        Ok(())
    }

    /// Drain queued local pushes, reconciling each against the current state.
    async fn drain_outbox(&mut self) -> Result<(), SyncError> {
        let entries = self
            .store
            .list_outbox(&self.remote_id, &self.local_vault_id)
            .await?;
        for entry in entries {
            self.reconcile_path(&entry.path).await?;
            self.store.delete_outbox(entry.id).await?;
        }
        self.refresh_status().await;
        Ok(())
    }

    async fn enqueue_local(&mut self, change: LocalChange) -> Result<(), SyncError> {
        let (path, op, hash) = match change {
            LocalChange::Upserted { path, hash } => (path, OutboxOp::Upsert, Some(hash)),
            LocalChange::Deleted { path } => (path, OutboxOp::Delete, None),
        };
        self.store
            .enqueue_outbox(
                &self.remote_id,
                &self.local_vault_id,
                &path,
                op,
                None,
                hash.as_deref(),
                now_ms(),
            )
            .await?;
        Ok(())
    }

    // ── The core: reconcile one path and apply the decision ─────────────────

    async fn reconcile_path(&mut self, path: &str) -> Result<(), SyncError> {
        let base = self
            .store
            .get_base_hash(&self.remote_id, &self.local_vault_id, path)
            .await?;
        let local = self.local_hash(path);
        let remote = self.remote_hashes.get(path).cloned();

        let decision = reconcile(base.as_deref(), local.as_deref(), remote.as_deref());
        self.apply(path, local, remote, decision).await
    }

    async fn apply(
        &mut self,
        path: &str,
        local: Option<String>,
        remote: Option<String>,
        decision: Decision,
    ) -> Result<(), SyncError> {
        match decision.action {
            Action::Noop | Action::AdoptBase => {}
            Action::PushUpsert => {
                let bytes = self.read_local(path)?;
                let client = self.client.clone();
                let vault = self.remote_vault_id.clone();
                let p = path.to_string();
                with_retry("upload", move || {
                    let client = client.clone();
                    let vault = vault.clone();
                    let p = p.clone();
                    let bytes = bytes.clone();
                    async move { client.upload_file_bytes(&vault, &p, bytes).await }
                })
                .await?;
                if let Some(h) = &local {
                    self.remote_hashes.insert(path.to_string(), h.clone());
                }
            }
            Action::PushDelete => {
                // Ignore a not-found on the remote; the end state is the same.
                if let Err(e) = self.client.delete_file(&self.remote_vault_id, path).await {
                    warn!("sync: remote delete of {path} failed (continuing): {e}");
                }
                self.remote_hashes.remove(path);
            }
            Action::PullUpsert => {
                let client = self.client.clone();
                let vault = self.remote_vault_id.clone();
                let p = path.to_string();
                let bytes = with_retry("download", move || {
                    let client = client.clone();
                    let vault = vault.clone();
                    let p = p.clone();
                    async move { client.download_file_bytes(&vault, &p).await }
                })
                .await?;
                self.write_local(path, &bytes)?;
            }
            Action::PullDelete => {
                self.delete_local(path)?;
            }
            Action::Conflict { winner } => {
                self.apply_conflict(path, local, remote, winner).await?;
            }
        }

        // Persist the agreed base for this path.
        self.store
            .set_base_hash(
                &self.remote_id,
                &self.local_vault_id,
                path,
                decision.new_base.as_deref(),
            )
            .await?;
        Ok(())
    }

    /// Keep-both conflict resolution. The winner takes the canonical path; the
    /// loser's content (if any) is preserved in a `conflict_*` sibling that is
    /// itself queued for the other side, so neither machine loses data.
    async fn apply_conflict(
        &mut self,
        path: &str,
        local: Option<String>,
        _remote: Option<String>,
        winner: ConflictWinner,
    ) -> Result<(), SyncError> {
        match winner {
            ConflictWinner::Remote => {
                // Preserve the local copy (if present) as a conflict sibling and
                // push it, then overwrite the canonical path with the remote copy.
                if local.is_some() {
                    let local_bytes = self.read_local(path)?;
                    let conflict_path = conflict_name(path);
                    self.write_local(&conflict_path, &local_bytes)?;
                    // Send the preserved copy to the remote too.
                    self.client
                        .upload_file_bytes(
                            &self.remote_vault_id,
                            &conflict_path,
                            local_bytes.clone(),
                        )
                        .await?;
                    let ch = hash_bytes(&local_bytes);
                    self.remote_hashes.insert(conflict_path.clone(), ch.clone());
                    self.store
                        .set_base_hash(
                            &self.remote_id,
                            &self.local_vault_id,
                            &conflict_path,
                            Some(&ch),
                        )
                        .await?;
                }
                let remote_bytes = self
                    .client
                    .download_file_bytes(&self.remote_vault_id, path)
                    .await?;
                self.write_local(path, &remote_bytes)?;
            }
            ConflictWinner::Local => {
                // Local edit beat a remote deletion: resurrect it on the remote.
                let bytes = self.read_local(path)?;
                self.client
                    .upload_file_bytes(&self.remote_vault_id, path, bytes)
                    .await?;
                if let Some(h) = &local {
                    self.remote_hashes.insert(path.to_string(), h.clone());
                }
            }
        }
        Ok(())
    }

    // ── Local filesystem helpers ────────────────────────────────────────────

    fn abs(&self, path: &str) -> PathBuf {
        self.local_vault_path.join(path)
    }

    fn local_hash(&self, path: &str) -> Option<String> {
        let abs = self.abs(path);
        if abs.is_file() {
            hash_file(&abs).ok()
        } else {
            None
        }
    }

    fn read_local(&self, path: &str) -> Result<Vec<u8>, SyncError> {
        Ok(std::fs::read(self.abs(path))?)
    }

    /// Write bytes locally, suppressing the resulting watcher event so the engine
    /// does not re-detect and re-push its own write.
    fn write_local(&self, path: &str, bytes: &[u8]) -> Result<(), SyncError> {
        self.suppressor.suppress(path, &hash_bytes(bytes));
        let abs = self.abs(path);
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&abs, bytes)?;
        Ok(())
    }

    fn delete_local(&self, path: &str) -> Result<(), SyncError> {
        let abs = self.abs(path);
        if abs.exists() {
            std::fs::remove_file(&abs)?;
        }
        Ok(())
    }

    // ── Status ──────────────────────────────────────────────────────────────

    fn set_state(&self, state: VaultSyncState, err: Option<String>) {
        if let Ok(mut m) = self.status.lock() {
            let entry = m.entry(self.status_key.clone()).or_insert(VaultStatus {
                remote_id: self.remote_id.clone(),
                local_vault_id: self.local_vault_id.clone(),
                state,
                last_synced_seq: self.last_seq,
                pending_outbox: 0,
                last_error: None,
                synced: 0,
                total: 0,
            });
            entry.state = state;
            entry.last_synced_seq = self.last_seq;
            if err.is_some() {
                entry.last_error = err;
            }
            // Clear a previous error once we advance past Offline.
            if matches!(state, VaultSyncState::Live | VaultSyncState::Syncing) {
                entry.last_error = None;
            }
            // Reset the progress counter when leaving the syncing phase.
            if !matches!(state, VaultSyncState::Syncing) {
                entry.synced = 0;
                entry.total = 0;
            }
        }
    }

    /// Report reconcile progress (files processed / total) for the status panel.
    fn set_progress(&self, synced: i64, total: i64) {
        if let Ok(mut m) = self.status.lock() {
            if let Some(entry) = m.get_mut(&self.status_key) {
                entry.synced = synced;
                entry.total = total;
            }
        }
    }

    async fn refresh_status(&self) {
        let pending = self
            .store
            .outbox_len(&self.remote_id, &self.local_vault_id)
            .await
            .unwrap_or(0);
        if let Ok(mut m) = self.status.lock() {
            if let Some(entry) = m.get_mut(&self.status_key) {
                entry.last_synced_seq = self.last_seq;
                entry.pending_outbox = pending;
            }
        }
    }
}

/// Retry a client operation on transient transport errors (a dropped/reset
/// connection, a connect timeout, or a "sending request" failure), with
/// exponential backoff. This keeps one flaky request from aborting an entire
/// reconcile pass over thousands of files. Non-transport errors (auth, 4xx/5xx
/// bodies, serde) fail immediately.
async fn with_retry<T, F, Fut>(label: &str, mut op: F) -> Result<T, SyncError>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, librarium_client::ClientError>>,
{
    const MAX_ATTEMPTS: u32 = 4;
    let mut delay = Duration::from_millis(500);
    let mut attempt = 0u32;
    loop {
        attempt += 1;
        match op().await {
            Ok(v) => return Ok(v),
            Err(e) if attempt < MAX_ATTEMPTS && is_transient(&e) => {
                warn!(
                    "sync {label} failed (attempt {attempt}/{MAX_ATTEMPTS}): {e} — retrying in {}ms",
                    delay.as_millis()
                );
                tokio::time::sleep(delay).await;
                delay = (delay * 2).min(Duration::from_secs(5));
            }
            Err(e) => return Err(e.into()),
        }
    }
}

/// True for reqwest transport-level failures that are worth retrying.
fn is_transient(e: &librarium_client::ClientError) -> bool {
    match e {
        librarium_client::ClientError::Http(inner) => {
            inner.is_connect() || inner.is_timeout() || inner.is_request()
        }
        _ => false,
    }
}

/// Walk a vault directory and return every syncable file's vault-relative path,
/// skipping dot-entries (matching the server manifest and watcher).
fn local_file_paths(vault_path: &Path) -> Vec<String> {
    use walkdir::WalkDir;
    let mut out = Vec::new();
    for entry in WalkDir::new(vault_path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            // Always keep the root (depth 0); prune dot-entries below it.
            e.depth() == 0
                || e.file_name()
                    .to_str()
                    .map(|n| !n.starts_with('.'))
                    .unwrap_or(false)
        })
        .filter_map(|e| e.ok())
    {
        let p = entry.path();
        if p.is_file() {
            let rel = p
                .strip_prefix(vault_path)
                .unwrap_or(p)
                .to_string_lossy()
                .replace('\\', "/");
            out.push(rel);
        }
    }
    out
}

/// Build the keep-both conflict filename for a path:
/// `dir/conflict_<stem>_<YYYYMMDD_HHMMSS>.<ext>`, matching the server's
/// `create_conflict_backup` convention.
fn conflict_name(path: &str) -> String {
    let ts = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let (dir, file) = match path.rsplit_once('/') {
        Some((d, f)) => (Some(d), f),
        None => (None, path),
    };
    let (stem, ext) = match file.rsplit_once('.') {
        Some((s, e)) => (s, Some(e)),
        None => (file, None),
    };
    let name = match ext {
        Some(e) => format!("conflict_{stem}_{ts}.{e}"),
        None => format!("conflict_{stem}_{ts}"),
    };
    match dir {
        Some(d) => format!("{d}/{name}"),
        None => name,
    }
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conflict_name_preserves_dir_and_ext() {
        let n = conflict_name("notes/todo.md");
        assert!(n.starts_with("notes/conflict_todo_"));
        assert!(n.ends_with(".md"));
    }

    #[test]
    fn conflict_name_handles_root_and_extensionless() {
        assert!(conflict_name("README").starts_with("conflict_README_"));
        let n = conflict_name("img.png");
        assert!(n.starts_with("conflict_img_") && n.ends_with(".png"));
    }

    #[tokio::test]
    async fn add_remote_persists_no_api_key() {
        let dir = tempfile::tempdir().unwrap();
        let engine = SyncEngine::open(&dir.path().join("sync.db"), Arc::new(|_: &str| None))
            .await
            .unwrap();

        engine
            .add_remote("r1".to_string(), "http://example.invalid".to_string())
            .await
            .unwrap();

        // RemoteRecord has no api_key field at all — this is a compile-time
        // guarantee as much as a runtime one — so there's nothing to assert
        // beyond the record round-tripping the fields it does have.
        let remotes = engine.list_remotes().await.unwrap();
        assert_eq!(remotes.len(), 1);
        assert_eq!(remotes[0].id, "r1");
        assert_eq!(remotes[0].base_url, "http://example.invalid");
    }

    #[tokio::test]
    async fn missing_api_key_surfaces_a_clear_error_before_any_network_call() {
        let dir = tempfile::tempdir().unwrap();
        let engine = SyncEngine::open(&dir.path().join("sync.db"), Arc::new(|_: &str| None))
            .await
            .unwrap();
        engine
            .add_remote("r1".to_string(), "http://example.invalid".to_string())
            .await
            .unwrap();

        let err = engine.list_remote_vaults("r1").await.unwrap_err();
        assert!(matches!(err, SyncError::State(ref s) if s.contains("no api key available")));
    }

    #[tokio::test]
    async fn key_provider_is_consulted_per_remote_id() {
        let dir = tempfile::tempdir().unwrap();
        let engine = SyncEngine::open(
            &dir.path().join("sync.db"),
            Arc::new(|remote_id: &str| (remote_id == "has-key").then(|| "the-secret".to_string())),
        )
        .await
        .unwrap();
        engine
            .add_remote("has-key".to_string(), "http://example.invalid".to_string())
            .await
            .unwrap();
        engine
            .add_remote("no-key".to_string(), "http://example.invalid".to_string())
            .await
            .unwrap();

        // Both attempt a real (failing, since example.invalid resolves nowhere)
        // network call, but only the keyless remote should fail on the key
        // lookup itself rather than getting as far as a client error.
        let err_with_key = engine.list_remote_vaults("has-key").await.unwrap_err();
        assert!(matches!(err_with_key, SyncError::Client(_)));
        let err_without_key = engine.list_remote_vaults("no-key").await.unwrap_err();
        assert!(matches!(err_without_key, SyncError::State(_)));
    }
}
