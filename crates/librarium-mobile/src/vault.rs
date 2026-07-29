//! Vault listing, backed by a local JSON registry instead of the server's
//! SQLite `vaults` table. Read-only in this slice: creating/removing a
//! configured vault is wired up by the pairing flow (a later Route C phase),
//! not here.

use chrono::{DateTime, Utc};
use librarium_core::error::{AppError, AppResult};
use librarium_types::Vault;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// On-disk shape of a configured vault entry. Deliberately narrower than
/// [`Vault`]: `path_exists` is never stored, since a vault's backing
/// directory can appear or disappear between reads (e.g. removable storage,
/// or a sync that hasn't run yet) — it's recomputed on every call instead.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredVault {
    id: String,
    name: String,
    path: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    #[serde(default = "default_document_format")]
    document_format: String,
}

fn default_document_format() -> String {
    "markdown".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct VaultRegistry {
    #[serde(default)]
    vaults: Vec<StoredVault>,
}

fn registry_path(config_dir: &Path) -> PathBuf {
    config_dir.join("vaults.json")
}

fn read_registry(config_dir: &Path) -> AppResult<VaultRegistry> {
    let path = registry_path(config_dir);
    if !path.exists() {
        return Ok(VaultRegistry::default());
    }
    let bytes = std::fs::read(&path)?;
    serde_json::from_slice(&bytes)
        .map_err(|e| AppError::InvalidInput(format!("Corrupt vault registry: {e}")))
}

fn to_vault(stored: StoredVault) -> Vault {
    let path_exists = Path::new(&stored.path).exists();
    Vault {
        id: stored.id,
        name: stored.name,
        path: stored.path,
        path_exists,
        created_at: stored.created_at,
        updated_at: stored.updated_at,
        document_format: stored.document_format,
    }
}

/// List every vault configured in `config_dir`'s local registry.
///
/// `config_dir` is the app's private config directory — callers must resolve
/// it via the Tauri path API (`app.path().app_config_dir()`), never a
/// CWD-relative path; this function only reads whatever directory it's
/// given, so tests can point it at a temp directory.
pub async fn vault_list(config_dir: &Path) -> AppResult<Vec<Vault>> {
    let config_dir = config_dir.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let registry = read_registry(&config_dir)?;
        Ok(registry.vaults.into_iter().map(to_vault).collect())
    })
    .await
    .map_err(|e| AppError::InternalError(format!("vault_list task join error: {e}")))?
}

/// Look up a single configured vault by id.
pub async fn vault_get(config_dir: &Path, vault_id: &str) -> AppResult<Vault> {
    let vaults = vault_list(config_dir).await?;
    vaults
        .into_iter()
        .find(|v| v.id == vault_id)
        .ok_or_else(|| AppError::NotFound(format!("Vault not found: {vault_id}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_registry(config_dir: &Path, entries: &[StoredVault]) {
        let registry = VaultRegistry {
            vaults: entries.to_vec(),
        };
        std::fs::write(
            registry_path(config_dir),
            serde_json::to_vec_pretty(&registry).unwrap(),
        )
        .unwrap();
    }

    fn sample_entry(id: &str, path: String) -> StoredVault {
        let now = Utc::now();
        StoredVault {
            id: id.to_string(),
            name: format!("Vault {id}"),
            path,
            created_at: now,
            updated_at: now,
            document_format: default_document_format(),
        }
    }

    #[tokio::test]
    async fn vault_list_empty_when_no_registry_file() {
        let config = TempDir::new().unwrap();
        let vaults = vault_list(config.path()).await.unwrap();
        assert!(vaults.is_empty());
    }

    #[tokio::test]
    async fn vault_list_returns_configured_vaults_with_computed_path_exists() {
        let config = TempDir::new().unwrap();
        let real_vault_dir = TempDir::new().unwrap();
        write_registry(
            config.path(),
            &[
                sample_entry("v1", real_vault_dir.path().to_string_lossy().to_string()),
                sample_entry("v2", "/does/not/exist".to_string()),
            ],
        );

        let vaults = vault_list(config.path()).await.unwrap();
        assert_eq!(vaults.len(), 2);
        let v1 = vaults.iter().find(|v| v.id == "v1").unwrap();
        let v2 = vaults.iter().find(|v| v.id == "v2").unwrap();
        assert!(v1.path_exists);
        assert!(!v2.path_exists);
        assert_eq!(v1.document_format, "markdown");
    }

    #[tokio::test]
    async fn vault_get_returns_matching_vault() {
        let config = TempDir::new().unwrap();
        let real_vault_dir = TempDir::new().unwrap();
        write_registry(
            config.path(),
            &[sample_entry(
                "v1",
                real_vault_dir.path().to_string_lossy().to_string(),
            )],
        );

        let vault = vault_get(config.path(), "v1").await.unwrap();
        assert_eq!(vault.id, "v1");
        assert!(vault.path_exists);
    }

    #[tokio::test]
    async fn vault_get_not_found_for_unknown_id() {
        let config = TempDir::new().unwrap();
        let err = vault_get(config.path(), "missing").await.unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[tokio::test]
    async fn vault_list_rejects_corrupt_registry() {
        let config = TempDir::new().unwrap();
        std::fs::write(registry_path(config.path()), b"not json").unwrap();
        let err = vault_list(config.path()).await.unwrap_err();
        assert!(matches!(err, AppError::InvalidInput(_)));
    }
}
