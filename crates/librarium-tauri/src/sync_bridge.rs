//! Desktop-side glue between the Tauri shell and the `librarium-sync` engine.
//!
//! The engine is created lazily once the embedded server is up (so vault paths
//! can be resolved from `librarium.db`) and then held in Tauri managed state so
//! the `sync_*` commands can drive it.

use anyhow::Context;
use librarium::config::SyncRemoteConfig;
use librarium::db::Database;
use librarium_sync::{SyncEngine, VaultStatus};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{info, warn};

/// A configured remote as surfaced to the UI (never exposes the API key).
#[derive(Debug, Clone, serde::Serialize)]
pub struct RemoteDto {
    pub id: String,
    pub base_url: String,
    pub enabled: bool,
}

/// Managed Tauri state wrapping the (lazily initialized) engine.
#[derive(Clone)]
pub struct SyncHandle {
    inner: Arc<Mutex<Option<Arc<SyncEngine>>>>,
    sync_db_path: PathBuf,
    /// `sqlite:`-prefixed URL of the embedded server's database, for resolving
    /// local vault ids to filesystem paths.
    db_url: String,
}

impl SyncHandle {
    pub fn new(sync_db_path: PathBuf, db_url: String) -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
            sync_db_path,
            db_url,
        }
    }

    /// Create the engine (if not already), seed it from `config.toml` remotes,
    /// and start the background tasks. Safe to call more than once — a second
    /// call restarts the tasks with the current store contents.
    pub async fn init_and_start(
        &self,
        remotes: &[SyncRemoteConfig],
    ) -> anyhow::Result<()> {
        let mut guard = self.inner.lock().await;
        if guard.is_none() {
            let engine = SyncEngine::open(&self.sync_db_path)
                .await
                .context("open sync.db")?;
            *guard = Some(Arc::new(engine));
        }
        let engine = guard.as_ref().unwrap().clone();

        // Reconcile the config bootstrap into the durable store.
        for remote in remotes {
            engine
                .add_remote(
                    remote.id.clone(),
                    remote.base_url.clone(),
                    remote.api_key.clone(),
                )
                .await?;
            for m in &remote.vault_map {
                match self.resolve_vault_path(&m.local_vault_id).await {
                    Some(path) => {
                        engine
                            .map_vault(
                                remote.id.clone(),
                                m.local_vault_id.clone(),
                                path,
                                m.remote_vault_id.clone(),
                            )
                            .await?;
                    }
                    None => warn!(
                        "sync: cannot resolve local vault {} — skipping mapping",
                        m.local_vault_id
                    ),
                }
            }
        }

        engine.stop();
        engine.start().await?;
        info!("sync engine started");
        Ok(())
    }

    pub async fn add_remote(&self, base_url: String, api_key: String) -> anyhow::Result<String> {
        let engine = self.ensure_engine().await?;
        let id = uuid::Uuid::new_v4().to_string();
        engine.add_remote(id.clone(), base_url, api_key).await?;
        Ok(id)
    }

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
        // Restart so the new mapping gets a task.
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
    ) -> anyhow::Result<Vec<librarium::models::Vault>> {
        let engine = self.ensure_engine().await?;
        Ok(engine.list_remote_vaults(&remote_id).await?)
    }

    /// Create a new vault on a registered remote.
    pub async fn create_remote_vault(
        &self,
        remote_id: String,
        name: String,
    ) -> anyhow::Result<librarium::models::Vault> {
        let engine = self.ensure_engine().await?;
        Ok(engine.create_remote_vault(&remote_id, &name).await?)
    }

    /// Remove a registered remote and everything mapped to it.
    pub async fn remove_remote(&self, remote_id: String) -> anyhow::Result<()> {
        let engine = self.ensure_engine().await?;
        engine.remove_remote(&remote_id).await?;
        // Restart so tasks for the removed remote stop running.
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
        // Restart so the removed mapping's task stops running.
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

    /// Resolve a local vault id to its on-disk path via `librarium.db`.
    async fn resolve_vault_path(&self, vault_id: &str) -> Option<String> {
        let db = Database::new(&self.db_url).await.ok()?;
        db.get_vault(vault_id).await.ok().map(|v| v.path)
    }
}
