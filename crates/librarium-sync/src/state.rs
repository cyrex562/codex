//! Durable sync state, persisted in its own SQLite database (`sync.db`) that is
//! kept entirely separate from the embedded server's `librarium.db`.
//!
//! It records, per (remote, local vault): the catch-up cursor
//! (`last_synced_seq`), the three-way merge base for every path
//! (`sync_file_state.base_hash`), and a durable outbound queue of local changes
//! waiting to be pushed (`sync_outbox`).

use crate::SyncError;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::path::Path;
use std::str::FromStr;

/// A configured remote server the desktop syncs against.
#[derive(Debug, Clone)]
pub struct RemoteRecord {
    pub id: String,
    pub base_url: String,
    pub api_key: String,
    pub enabled: bool,
}

/// A mapping between a local (embedded-server) vault and a remote vault.
#[derive(Debug, Clone)]
pub struct VaultMap {
    pub remote_id: String,
    pub local_vault_id: String,
    pub local_vault_path: String,
    pub remote_vault_id: String,
    pub last_synced_seq: i64,
}

/// One queued outbound local change.
#[derive(Debug, Clone)]
pub struct OutboxEntry {
    pub id: i64,
    pub remote_id: String,
    pub local_vault_id: String,
    pub path: String,
    pub op: OutboxOp,
    pub old_path: Option<String>,
    pub detected_hash: Option<String>,
    pub created_ms: i64,
}

/// The kind of local change queued for push.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutboxOp {
    Upsert,
    Delete,
}

impl OutboxOp {
    fn as_str(self) -> &'static str {
        match self {
            OutboxOp::Upsert => "upsert",
            OutboxOp::Delete => "delete",
        }
    }

    fn from_str(s: &str) -> Result<Self, SyncError> {
        match s {
            "upsert" => Ok(OutboxOp::Upsert),
            "delete" => Ok(OutboxOp::Delete),
            other => Err(SyncError::State(format!("unknown outbox op: {other}"))),
        }
    }
}

/// Handle to the sync-state database.
#[derive(Clone)]
pub struct SyncStore {
    pool: SqlitePool,
}

impl SyncStore {
    /// Open (creating if needed) the sync-state database at `path` and run
    /// migrations.
    pub async fn open(path: &Path) -> Result<Self, SyncError> {
        let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display()))
            .map_err(|e| SyncError::State(e.to_string()))?
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options)
            .await?;
        let store = Self { pool };
        store.migrate().await?;
        Ok(store)
    }

    /// Open an in-memory store (used by tests).
    #[cfg(test)]
    pub async fn open_in_memory() -> Result<Self, SyncError> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await?;
        let store = Self { pool };
        store.migrate().await?;
        Ok(store)
    }

    async fn migrate(&self) -> Result<(), SyncError> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS sync_remote (
                id TEXT PRIMARY KEY NOT NULL,
                base_url TEXT NOT NULL,
                api_key TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS sync_vault_map (
                remote_id TEXT NOT NULL,
                local_vault_id TEXT NOT NULL,
                local_vault_path TEXT NOT NULL,
                remote_vault_id TEXT NOT NULL,
                last_synced_seq INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (remote_id, local_vault_id)
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        // base_hash NULL is a tombstone (the path is known-absent); a missing row
        // means the path was never synced. Both reconcile to base = None.
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS sync_file_state (
                remote_id TEXT NOT NULL,
                local_vault_id TEXT NOT NULL,
                path TEXT NOT NULL,
                base_hash TEXT,
                PRIMARY KEY (remote_id, local_vault_id, path)
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS sync_outbox (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                remote_id TEXT NOT NULL,
                local_vault_id TEXT NOT NULL,
                path TEXT NOT NULL,
                op TEXT NOT NULL,
                old_path TEXT,
                detected_hash TEXT,
                created_ms INTEGER NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    // ── Remotes ─────────────────────────────────────────────────────────────

    pub async fn upsert_remote(&self, remote: &RemoteRecord) -> Result<(), SyncError> {
        sqlx::query(
            r#"
            INSERT INTO sync_remote (id, base_url, api_key, enabled)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                base_url = excluded.base_url,
                api_key = excluded.api_key,
                enabled = excluded.enabled
            "#,
        )
        .bind(&remote.id)
        .bind(&remote.base_url)
        .bind(&remote.api_key)
        .bind(remote.enabled as i64)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn list_remotes(&self) -> Result<Vec<RemoteRecord>, SyncError> {
        let rows = sqlx::query("SELECT id, base_url, api_key, enabled FROM sync_remote")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .into_iter()
            .map(|r| RemoteRecord {
                id: r.get("id"),
                base_url: r.get("base_url"),
                api_key: r.get("api_key"),
                enabled: r.get::<i64, _>("enabled") != 0,
            })
            .collect())
    }

    /// Delete a remote and everything scoped to it: its vault mappings, file
    /// state, and outbox entries.
    pub async fn delete_remote(&self, remote_id: &str) -> Result<(), SyncError> {
        sqlx::query("DELETE FROM sync_outbox WHERE remote_id = ?")
            .bind(remote_id)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM sync_file_state WHERE remote_id = ?")
            .bind(remote_id)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM sync_vault_map WHERE remote_id = ?")
            .bind(remote_id)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM sync_remote WHERE id = ?")
            .bind(remote_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // ── Vault mappings ──────────────────────────────────────────────────────

    pub async fn upsert_vault_map(&self, map: &VaultMap) -> Result<(), SyncError> {
        sqlx::query(
            r#"
            INSERT INTO sync_vault_map
                (remote_id, local_vault_id, local_vault_path, remote_vault_id, last_synced_seq)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(remote_id, local_vault_id) DO UPDATE SET
                local_vault_path = excluded.local_vault_path,
                remote_vault_id = excluded.remote_vault_id
            "#,
        )
        .bind(&map.remote_id)
        .bind(&map.local_vault_id)
        .bind(&map.local_vault_path)
        .bind(&map.remote_vault_id)
        .bind(map.last_synced_seq)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn list_vault_maps(&self, remote_id: &str) -> Result<Vec<VaultMap>, SyncError> {
        let rows = sqlx::query(
            r#"
            SELECT remote_id, local_vault_id, local_vault_path, remote_vault_id, last_synced_seq
            FROM sync_vault_map WHERE remote_id = ?
            "#,
        )
        .bind(remote_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| VaultMap {
                remote_id: r.get("remote_id"),
                local_vault_id: r.get("local_vault_id"),
                local_vault_path: r.get("local_vault_path"),
                remote_vault_id: r.get("remote_vault_id"),
                last_synced_seq: r.get("last_synced_seq"),
            })
            .collect())
    }

    pub async fn set_last_synced_seq(
        &self,
        remote_id: &str,
        local_vault_id: &str,
        seq: i64,
    ) -> Result<(), SyncError> {
        sqlx::query(
            r#"
            UPDATE sync_vault_map SET last_synced_seq = ?
            WHERE remote_id = ? AND local_vault_id = ?
            "#,
        )
        .bind(seq)
        .bind(remote_id)
        .bind(local_vault_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Delete one vault mapping and its associated file state / outbox rows.
    pub async fn delete_vault_map(
        &self,
        remote_id: &str,
        local_vault_id: &str,
    ) -> Result<(), SyncError> {
        sqlx::query("DELETE FROM sync_outbox WHERE remote_id = ? AND local_vault_id = ?")
            .bind(remote_id)
            .bind(local_vault_id)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM sync_file_state WHERE remote_id = ? AND local_vault_id = ?")
            .bind(remote_id)
            .bind(local_vault_id)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM sync_vault_map WHERE remote_id = ? AND local_vault_id = ?")
            .bind(remote_id)
            .bind(local_vault_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // ── Per-path base hash (three-way merge base) ───────────────────────────

    /// The base hash for a path. Both a missing row and a NULL (tombstone) row
    /// return `None`, which reconcile treats as "absent at the last sync".
    pub async fn get_base_hash(
        &self,
        remote_id: &str,
        local_vault_id: &str,
        path: &str,
    ) -> Result<Option<String>, SyncError> {
        let row = sqlx::query(
            r#"
            SELECT base_hash FROM sync_file_state
            WHERE remote_id = ? AND local_vault_id = ? AND path = ?
            "#,
        )
        .bind(remote_id)
        .bind(local_vault_id)
        .bind(path)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.and_then(|r| r.get::<Option<String>, _>("base_hash")))
    }

    /// Record the base hash for a path. `None` writes a tombstone row.
    pub async fn set_base_hash(
        &self,
        remote_id: &str,
        local_vault_id: &str,
        path: &str,
        base_hash: Option<&str>,
    ) -> Result<(), SyncError> {
        sqlx::query(
            r#"
            INSERT INTO sync_file_state (remote_id, local_vault_id, path, base_hash)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(remote_id, local_vault_id, path) DO UPDATE SET
                base_hash = excluded.base_hash
            "#,
        )
        .bind(remote_id)
        .bind(local_vault_id)
        .bind(path)
        .bind(base_hash)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Every path with a known (non-tombstone) base for a vault mapping. Used by
    /// manifest drift-repair to find local files the remote no longer lists.
    pub async fn known_paths(
        &self,
        remote_id: &str,
        local_vault_id: &str,
    ) -> Result<Vec<String>, SyncError> {
        let rows = sqlx::query(
            r#"
            SELECT path FROM sync_file_state
            WHERE remote_id = ? AND local_vault_id = ? AND base_hash IS NOT NULL
            "#,
        )
        .bind(remote_id)
        .bind(local_vault_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|r| r.get("path")).collect())
    }

    // ── Outbox ──────────────────────────────────────────────────────────────

    pub async fn enqueue_outbox(
        &self,
        remote_id: &str,
        local_vault_id: &str,
        path: &str,
        op: OutboxOp,
        old_path: Option<&str>,
        detected_hash: Option<&str>,
        created_ms: i64,
    ) -> Result<(), SyncError> {
        sqlx::query(
            r#"
            INSERT INTO sync_outbox
                (remote_id, local_vault_id, path, op, old_path, detected_hash, created_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(remote_id)
        .bind(local_vault_id)
        .bind(path)
        .bind(op.as_str())
        .bind(old_path)
        .bind(detected_hash)
        .bind(created_ms)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Drain the queued outbound entries for a vault mapping, oldest first.
    pub async fn list_outbox(
        &self,
        remote_id: &str,
        local_vault_id: &str,
    ) -> Result<Vec<OutboxEntry>, SyncError> {
        let rows = sqlx::query(
            r#"
            SELECT id, remote_id, local_vault_id, path, op, old_path, detected_hash, created_ms
            FROM sync_outbox
            WHERE remote_id = ? AND local_vault_id = ?
            ORDER BY id ASC
            "#,
        )
        .bind(remote_id)
        .bind(local_vault_id)
        .fetch_all(&self.pool)
        .await?;
        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            out.push(OutboxEntry {
                id: r.get("id"),
                remote_id: r.get("remote_id"),
                local_vault_id: r.get("local_vault_id"),
                path: r.get("path"),
                op: OutboxOp::from_str(&r.get::<String, _>("op"))?,
                old_path: r.get("old_path"),
                detected_hash: r.get("detected_hash"),
                created_ms: r.get("created_ms"),
            });
        }
        Ok(out)
    }

    pub async fn delete_outbox(&self, id: i64) -> Result<(), SyncError> {
        sqlx::query("DELETE FROM sync_outbox WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn outbox_len(
        &self,
        remote_id: &str,
        local_vault_id: &str,
    ) -> Result<i64, SyncError> {
        let row = sqlx::query(
            "SELECT COUNT(*) AS n FROM sync_outbox WHERE remote_id = ? AND local_vault_id = ?",
        )
        .bind(remote_id)
        .bind(local_vault_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.get("n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn base_hash_missing_and_tombstone_both_none() {
        let store = SyncStore::open_in_memory().await.unwrap();
        // Missing row -> None.
        assert_eq!(store.get_base_hash("r", "v", "a.md").await.unwrap(), None);
        // Explicit tombstone -> None.
        store.set_base_hash("r", "v", "a.md", None).await.unwrap();
        assert_eq!(store.get_base_hash("r", "v", "a.md").await.unwrap(), None);
        // Known hash round-trips.
        store.set_base_hash("r", "v", "a.md", Some("h1")).await.unwrap();
        assert_eq!(
            store.get_base_hash("r", "v", "a.md").await.unwrap(),
            Some("h1".to_string())
        );
    }

    #[tokio::test]
    async fn outbox_is_fifo_and_deletable() {
        let store = SyncStore::open_in_memory().await.unwrap();
        store
            .enqueue_outbox("r", "v", "a.md", OutboxOp::Upsert, None, Some("h"), 1)
            .await
            .unwrap();
        store
            .enqueue_outbox("r", "v", "b.md", OutboxOp::Delete, None, None, 2)
            .await
            .unwrap();
        let entries = store.list_outbox("r", "v").await.unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, "a.md");
        assert_eq!(entries[0].op, OutboxOp::Upsert);
        assert_eq!(entries[1].op, OutboxOp::Delete);
        assert_eq!(store.outbox_len("r", "v").await.unwrap(), 2);
        store.delete_outbox(entries[0].id).await.unwrap();
        assert_eq!(store.outbox_len("r", "v").await.unwrap(), 1);
    }

    #[tokio::test]
    async fn known_paths_excludes_tombstones() {
        let store = SyncStore::open_in_memory().await.unwrap();
        store.set_base_hash("r", "v", "keep.md", Some("h")).await.unwrap();
        store.set_base_hash("r", "v", "gone.md", None).await.unwrap();
        let paths = store.known_paths("r", "v").await.unwrap();
        assert_eq!(paths, vec!["keep.md".to_string()]);
    }

    #[tokio::test]
    async fn delete_remote_cascades() {
        let store = SyncStore::open_in_memory().await.unwrap();
        store
            .upsert_remote(&RemoteRecord {
                id: "r".to_string(),
                base_url: "http://x".to_string(),
                api_key: "k".to_string(),
                enabled: true,
            })
            .await
            .unwrap();
        store
            .upsert_vault_map(&VaultMap {
                remote_id: "r".to_string(),
                local_vault_id: "v".to_string(),
                local_vault_path: "/tmp/v".to_string(),
                remote_vault_id: "rv".to_string(),
                last_synced_seq: 0,
            })
            .await
            .unwrap();
        store.set_base_hash("r", "v", "a.md", Some("h")).await.unwrap();
        store
            .enqueue_outbox("r", "v", "a.md", OutboxOp::Upsert, None, Some("h"), 1)
            .await
            .unwrap();

        store.delete_remote("r").await.unwrap();

        assert!(store.list_remotes().await.unwrap().is_empty());
        assert!(store.list_vault_maps("r").await.unwrap().is_empty());
        assert_eq!(store.get_base_hash("r", "v", "a.md").await.unwrap(), None);
        assert_eq!(store.outbox_len("r", "v").await.unwrap(), 0);
    }

    #[tokio::test]
    async fn delete_vault_map_removes_only_that_mapping() {
        let store = SyncStore::open_in_memory().await.unwrap();
        for v in ["v1", "v2"] {
            store
                .upsert_vault_map(&VaultMap {
                    remote_id: "r".to_string(),
                    local_vault_id: v.to_string(),
                    local_vault_path: format!("/tmp/{v}"),
                    remote_vault_id: format!("rv-{v}"),
                    last_synced_seq: 0,
                })
                .await
                .unwrap();
            store.set_base_hash("r", v, "a.md", Some("h")).await.unwrap();
            store
                .enqueue_outbox("r", v, "a.md", OutboxOp::Upsert, None, Some("h"), 1)
                .await
                .unwrap();
        }

        store.delete_vault_map("r", "v1").await.unwrap();

        let maps = store.list_vault_maps("r").await.unwrap();
        assert_eq!(maps.len(), 1);
        assert_eq!(maps[0].local_vault_id, "v2");
        assert_eq!(store.get_base_hash("r", "v1", "a.md").await.unwrap(), None);
        assert_eq!(store.outbox_len("r", "v1").await.unwrap(), 0);
        // v2 untouched.
        assert_eq!(
            store.get_base_hash("r", "v2", "a.md").await.unwrap(),
            Some("h".to_string())
        );
        assert_eq!(store.outbox_len("r", "v2").await.unwrap(), 1);
    }
}
