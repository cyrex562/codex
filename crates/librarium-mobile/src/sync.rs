//! Local sync bridge — the Route C thin-client counterpart to
//! `librarium-tauri/src/sync_bridge.rs`. Ports that file's `SyncHandle`
//! essentially unchanged: `librarium-sync`'s [`SyncEngine`] is already fully
//! server-agnostic (`map_vault` takes a plain local filesystem path), so the
//! only real difference between the two bridges is how a local vault id is
//! resolved to a path. The desktop bridge looks it up in the embedded
//! server's `librarium.db`; this one reads the same `vaults.json` registry
//! [`crate::vault`] already uses. **No changes were made to
//! `crates/librarium-sync` for this.**
//!
//! Unlike the desktop bridge, there is no `config.toml` to seed remotes from
//! at startup — mobile has no equivalent bootstrap file — so `init_and_start`
//! is intentionally not ported. Remotes are only ever added interactively via
//! `sync_add_remote`.

use anyhow::Context;
use librarium_sync::{SyncEngine, VaultStatus};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

/// A configured remote as surfaced to the UI (never exposes the API key).
#[derive(Debug, Clone, serde::Serialize)]
pub struct RemoteDto {
    pub id: String,
    pub base_url: String,
    pub enabled: bool,
}

/// Managed Tauri state wrapping the lazily initialized [`SyncEngine`].
#[derive(Clone)]
pub struct SyncHandle {
    inner: Arc<Mutex<Option<Arc<SyncEngine>>>>,
    sync_db_path: PathBuf,
    /// The app-private config directory holding `vaults.json`, for resolving
    /// local vault ids to filesystem paths (see [`crate::vault`]).
    config_dir: PathBuf,
}

impl SyncHandle {
    pub fn new(sync_db_path: PathBuf, config_dir: PathBuf) -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
            sync_db_path,
            config_dir,
        }
    }

    /// Register a remote server, returning its generated id.
    pub async fn add_remote(&self, base_url: String, api_key: String) -> anyhow::Result<String> {
        let engine = self.ensure_engine().await?;
        let id = uuid::Uuid::new_v4().to_string();
        engine.add_remote(id.clone(), base_url, api_key).await?;
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

    /// Remove a registered remote and everything mapped to it.
    pub async fn remove_remote(&self, remote_id: String) -> anyhow::Result<()> {
        let engine = self.ensure_engine().await?;
        engine.remove_remote(&remote_id).await?;
        engine.stop();
        engine.start().await?;
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

    async fn ensure_engine(&self) -> anyhow::Result<Arc<SyncEngine>> {
        let mut guard = self.inner.lock().await;
        if guard.is_none() {
            let engine = SyncEngine::open(&self.sync_db_path)
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
    use tempfile::TempDir;

    fn handle(config: &TempDir, sync_dir: &TempDir) -> SyncHandle {
        SyncHandle::new(sync_dir.path().join("sync.db"), config.path().to_path_buf())
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
}
