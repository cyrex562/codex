//! Local sync bridge — the Route C thin-client counterpart to
//! `librarium-tauri/src/sync_bridge.rs`. Ports that file's `SyncHandle`
//! essentially unchanged: `librarium-sync`'s [`SyncEngine`] is already fully
//! server-agnostic (`map_vault` takes a plain local filesystem path), so the
//! only real difference between the two bridges is how a local vault id is
//! resolved to a path. The desktop bridge looks it up in the embedded
//! server's `librarium.db`; this one reads the same `vaults.json` registry
//! [`crate::vault`] already uses.
//!
//! Unlike the desktop bridge, there is no `config.toml` to seed remotes from
//! at startup — mobile has no equivalent bootstrap file — so `init_and_start`
//! is intentionally not ported. Remotes are only ever added interactively via
//! `sync_add_remote` or `pairing_set`.
//!
//! ## API keys are never persisted in plaintext
//!
//! `librarium-sync`'s `RemoteRecord` holds no `api_key` field, and `sync.db`
//! never contains one — `SyncEngine::open` instead takes an
//! [`librarium_sync::ApiKeyProvider`] closure, consulted at connection time.
//! Here that provider reads from a [`crate::secrets::SecretStore`]
//! (`OsKeyringStore` in production — the platform Keychain / Credential
//! Manager / Secret Service / Android Keystore — `InMemorySecretStore` in
//! tests). This is the one deliberate, minimal change made to
//! `crates/librarium-sync` for issue #54: see that crate's `ApiKeyProvider`
//! doc for the full rationale.

use crate::secrets::SecretStore;
use anyhow::Context;
use librarium_sync::{ApiKeyProvider, SyncEngine, VaultStatus};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

/// The fixed remote id used by the `pairing_*` commands. Mobile pairs with
/// one remote at a time through that opinionated API; `sync_add_remote` (the
/// general, multi-remote API from #53) still works alongside it with its own
/// generated ids.
const PAIRED_REMOTE_ID: &str = "primary";

/// A configured remote as surfaced to the UI (never exposes the API key).
#[derive(Debug, Clone, serde::Serialize)]
pub struct RemoteDto {
    pub id: String,
    pub base_url: String,
    pub enabled: bool,
}

/// The paired remote's connection info, as surfaced to the UI — the API key
/// itself never appears here, only whether one is currently stored.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PairingInfo {
    pub base_url: String,
    pub key_present: bool,
}

/// Managed Tauri state wrapping the lazily initialized [`SyncEngine`].
#[derive(Clone)]
pub struct SyncHandle {
    inner: Arc<Mutex<Option<Arc<SyncEngine>>>>,
    sync_db_path: PathBuf,
    /// The app-private config directory holding `vaults.json`, for resolving
    /// local vault ids to filesystem paths (see [`crate::vault`]).
    config_dir: PathBuf,
    secrets: Arc<dyn SecretStore>,
}

impl SyncHandle {
    pub fn new(sync_db_path: PathBuf, config_dir: PathBuf, secrets: Arc<dyn SecretStore>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
            sync_db_path,
            config_dir,
            secrets,
        }
    }

    fn key_provider(&self) -> ApiKeyProvider {
        let secrets = self.secrets.clone();
        Arc::new(move |remote_id: &str| secrets.get(remote_id).ok().flatten())
    }

    async fn add_remote_with_id(
        &self,
        id: String,
        base_url: String,
        api_key: String,
    ) -> anyhow::Result<()> {
        self.secrets.set(&id, &api_key)?;
        let engine = self.ensure_engine().await?;
        engine.add_remote(id, base_url).await?;
        Ok(())
    }

    /// Register a remote server, returning its generated id.
    pub async fn add_remote(&self, base_url: String, api_key: String) -> anyhow::Result<String> {
        let id = uuid::Uuid::new_v4().to_string();
        self.add_remote_with_id(id.clone(), base_url, api_key)
            .await?;
        Ok(id)
    }

    /// Map a local vault to a remote vault under a remote, then restart the
    /// background tasks so the new mapping gets one.
    pub async fn map_vault(
        &self,
        remote_id: String,
        local_vault_id: String,
        remote_vault_id: String,
    ) -> anyhow::Result<()> {
        let engine = self.ensure_engine().await?;
        let path = self
            .resolve_vault_path(&local_vault_id)
            .await
            .with_context(|| format!("unknown local vault {local_vault_id}"))?;
        engine
            .map_vault(remote_id, local_vault_id, path, remote_vault_id)
            .await?;
        engine.stop();
        engine.start().await?;
        Ok(())
    }

    pub async fn list_remotes(&self) -> anyhow::Result<Vec<RemoteDto>> {
        let engine = self.ensure_engine().await?;
        Ok(engine
            .list_remotes()
            .await?
            .into_iter()
            .map(|r| RemoteDto {
                id: r.id,
                base_url: r.base_url,
                enabled: r.enabled,
            })
            .collect())
    }

    /// List the vaults available on a registered remote.
    pub async fn list_remote_vaults(
        &self,
        remote_id: String,
    ) -> anyhow::Result<Vec<librarium_types::Vault>> {
        let engine = self.ensure_engine().await?;
        Ok(engine.list_remote_vaults(&remote_id).await?)
    }

    /// Create a new vault on a registered remote.
    pub async fn create_remote_vault(
        &self,
        remote_id: String,
        name: String,
    ) -> anyhow::Result<librarium_types::Vault> {
        let engine = self.ensure_engine().await?;
        Ok(engine.create_remote_vault(&remote_id, &name).await?)
    }

    /// Remove a registered remote, everything mapped to it, and its stored key.
    pub async fn remove_remote(&self, remote_id: String) -> anyhow::Result<()> {
        let engine = self.ensure_engine().await?;
        engine.remove_remote(&remote_id).await?;
        engine.stop();
        engine.start().await?;
        self.secrets.clear(&remote_id)?;
        Ok(())
    }

    /// Remove a single local-to-remote vault mapping.
    pub async fn unmap_vault(
        &self,
        remote_id: String,
        local_vault_id: String,
    ) -> anyhow::Result<()> {
        let engine = self.ensure_engine().await?;
        engine.unmap_vault(&remote_id, &local_vault_id).await?;
        engine.stop();
        engine.start().await?;
        Ok(())
    }

    pub async fn status(&self) -> Vec<VaultStatus> {
        let guard = self.inner.lock().await;
        match guard.as_ref() {
            Some(engine) => engine.status(),
            None => Vec::new(),
        }
    }

    pub async fn start(&self) -> anyhow::Result<()> {
        let engine = self.ensure_engine().await?;
        engine.start().await?;
        Ok(())
    }

    pub async fn stop(&self) {
        let guard = self.inner.lock().await;
        if let Some(engine) = guard.as_ref() {
            engine.stop();
        }
    }

    /// One coarse reconcile pass for every mapped vault, with no live
    /// WebSocket kept open afterward — for a background caller (Android's
    /// `MobileSyncService`, or a manual "sync now") rather than the
    /// always-live tasks [`Self::start`] spawns. See
    /// [`librarium_sync::SyncEngine::reconcile_once`].
    pub async fn reconcile_once(&self) -> anyhow::Result<()> {
        let engine = self.ensure_engine().await?;
        engine.reconcile_once().await?;
        Ok(())
    }

    /// Validate `base_url`/`api_key` against the remote with a cheap
    /// authenticated call — so a wrong key surfaces immediately here rather
    /// than as a silent, perpetually-offline sync task — then store the key
    /// in platform secure storage and register the paired remote.
    pub async fn pairing_set(&self, base_url: String, api_key: String) -> anyhow::Result<()> {
        let client = librarium_client::ObsidianClient::for_cloud(base_url.clone())
            .with_api_key(api_key.clone());
        client
            .list_vaults()
            .await
            .context("could not validate the remote URL / API key")?;

        self.add_remote_with_id(PAIRED_REMOTE_ID.to_string(), base_url, api_key)
            .await
    }

    /// The paired remote's base URL and whether a key is currently stored —
    /// never the key itself. `None` if nothing has been paired yet.
    pub async fn pairing_get(&self) -> anyhow::Result<Option<PairingInfo>> {
        let remotes = self.list_remotes().await?;
        let Some(remote) = remotes.into_iter().find(|r| r.id == PAIRED_REMOTE_ID) else {
            return Ok(None);
        };
        let key_present = self.secrets.get(PAIRED_REMOTE_ID)?.is_some();
        Ok(Some(PairingInfo {
            base_url: remote.base_url,
            key_present,
        }))
    }

    /// Stop syncing, remove the paired remote, and erase the stored key.
    pub async fn pairing_clear(&self) -> anyhow::Result<()> {
        self.remove_remote(PAIRED_REMOTE_ID.to_string()).await
    }

    async fn ensure_engine(&self) -> anyhow::Result<Arc<SyncEngine>> {
        let mut guard = self.inner.lock().await;
        if guard.is_none() {
            let engine = SyncEngine::open(&self.sync_db_path, self.key_provider())
                .await
                .context("open sync.db")?;
            *guard = Some(Arc::new(engine));
        }
        Ok(guard.as_ref().unwrap().clone())
    }

    /// Resolve a local vault id to its on-disk path via the local vault
    /// registry (`vaults.json`), mirroring what the desktop bridge does
    /// against `librarium.db`.
    async fn resolve_vault_path(&self, vault_id: &str) -> Option<String> {
        crate::vault::vault_get(&self.config_dir, vault_id)
            .await
            .ok()
            .map(|v| v.path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::InMemorySecretStore;
    use tempfile::TempDir;

    fn handle(config: &TempDir, sync_dir: &TempDir) -> SyncHandle {
        SyncHandle::new(
            sync_dir.path().join("sync.db"),
            config.path().to_path_buf(),
            Arc::new(InMemorySecretStore::default()),
        )
    }

    #[tokio::test]
    async fn status_is_empty_before_any_engine_exists() {
        let config = TempDir::new().unwrap();
        let sync_dir = TempDir::new().unwrap();
        let h = handle(&config, &sync_dir);
        assert!(h.status().await.is_empty());
    }

    #[tokio::test]
    async fn add_remote_generates_an_id_and_persists_it() {
        let config = TempDir::new().unwrap();
        let sync_dir = TempDir::new().unwrap();
        let h = handle(&config, &sync_dir);

        let id = h
            .add_remote("http://example.invalid".to_string(), "key".to_string())
            .await
            .unwrap();
        assert!(!id.is_empty());

        let remotes = h.list_remotes().await.unwrap();
        assert_eq!(remotes.len(), 1);
        assert_eq!(remotes[0].id, id);
        assert_eq!(remotes[0].base_url, "http://example.invalid");
        assert!(remotes[0].enabled);
    }

    #[tokio::test]
    async fn map_vault_fails_for_an_unknown_local_vault() {
        let config = TempDir::new().unwrap();
        let sync_dir = TempDir::new().unwrap();
        let h = handle(&config, &sync_dir);

        let remote_id = h
            .add_remote("http://example.invalid".to_string(), "key".to_string())
            .await
            .unwrap();

        let err = h
            .map_vault(
                remote_id,
                "missing-vault".to_string(),
                "r-vault".to_string(),
            )
            .await
            .unwrap_err();
        assert!(err.to_string().contains("missing-vault"));
    }

    #[tokio::test]
    async fn remove_remote_and_unmap_vault_are_idempotent_on_the_empty_state() {
        let config = TempDir::new().unwrap();
        let sync_dir = TempDir::new().unwrap();
        let h = handle(&config, &sync_dir);

        // Neither call should error even though nothing has been added yet.
        h.remove_remote("does-not-exist".to_string()).await.unwrap();
        h.unmap_vault("does-not-exist".to_string(), "v".to_string())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn stop_before_any_engine_exists_is_a_noop() {
        let config = TempDir::new().unwrap();
        let sync_dir = TempDir::new().unwrap();
        let h = handle(&config, &sync_dir);
        h.stop().await; // must not panic
    }

    #[tokio::test]
    async fn add_remote_stores_the_key_in_the_secret_store_not_just_sync_db() {
        let config = TempDir::new().unwrap();
        let sync_dir = TempDir::new().unwrap();
        let secrets = Arc::new(InMemorySecretStore::default());
        let h = SyncHandle::new(
            sync_dir.path().join("sync.db"),
            config.path().to_path_buf(),
            secrets.clone(),
        );

        let id = h
            .add_remote("http://example.invalid".to_string(), "s3cr3t".to_string())
            .await
            .unwrap();

        assert_eq!(secrets.get(&id).unwrap(), Some("s3cr3t".to_string()));
    }

    #[tokio::test]
    async fn remove_remote_clears_the_stored_key() {
        let config = TempDir::new().unwrap();
        let sync_dir = TempDir::new().unwrap();
        let secrets = Arc::new(InMemorySecretStore::default());
        let h = SyncHandle::new(
            sync_dir.path().join("sync.db"),
            config.path().to_path_buf(),
            secrets.clone(),
        );

        let id = h
            .add_remote("http://example.invalid".to_string(), "s3cr3t".to_string())
            .await
            .unwrap();
        h.remove_remote(id.clone()).await.unwrap();

        assert_eq!(secrets.get(&id).unwrap(), None);
    }

    #[tokio::test]
    async fn pairing_get_is_none_before_pairing_set() {
        let config = TempDir::new().unwrap();
        let sync_dir = TempDir::new().unwrap();
        let h = handle(&config, &sync_dir);
        assert!(h.pairing_get().await.unwrap().is_none());
    }

    #[tokio::test]
    async fn pairing_set_rejects_an_unreachable_remote_without_persisting_anything() {
        let config = TempDir::new().unwrap();
        let sync_dir = TempDir::new().unwrap();
        let secrets = Arc::new(InMemorySecretStore::default());
        let h = SyncHandle::new(
            sync_dir.path().join("sync.db"),
            config.path().to_path_buf(),
            secrets.clone(),
        );

        let err = h
            .pairing_set("http://example.invalid".to_string(), "wrong".to_string())
            .await
            .unwrap_err();
        assert!(err.to_string().contains("could not validate"));

        // Nothing should have been persisted: neither the remote record...
        assert!(h.pairing_get().await.unwrap().is_none());
        // ...nor the key.
        assert_eq!(secrets.get("primary").unwrap(), None);
    }

    #[tokio::test]
    async fn pairing_clear_before_any_pairing_is_a_noop() {
        let config = TempDir::new().unwrap();
        let sync_dir = TempDir::new().unwrap();
        let h = handle(&config, &sync_dir);
        h.pairing_clear().await.unwrap();
    }

    #[tokio::test]
    async fn reconcile_once_with_nothing_mapped_is_a_noop() {
        let config = TempDir::new().unwrap();
        let sync_dir = TempDir::new().unwrap();
        let h = handle(&config, &sync_dir);
        h.reconcile_once().await.unwrap();
        assert!(h.status().await.is_empty());
    }
}
