//! Local metadata store — preferences, recent files, favorites, and
//! bookmarks — backed by its own SQLite database (`mobile.db`), the same
//! `sqlx` stack `librarium-sync` already uses for `sync.db`
//! (`crates/librarium-sync/src/state.rs::SyncStore` is the pattern this
//! mirrors: `SqliteConnectOptions::create_if_missing`, idempotent
//! `CREATE TABLE IF NOT EXISTS` migrations run on every open).
//!
//! `mobile.db` is deliberately kept separate from `sync.db` — they have
//! different lifecycles. `sync.db` should be safe to delete to force a full
//! re-reconcile (per librarium-sync's own doc comment); deleting it must
//! never take a user's favorites or preferences with it.
//!
//! This metadata is device-local and **not synced** to the server or to any
//! other device. There is no server-side contract for syncing favorites,
//! bookmarks, or per-device preferences today — inventing one here would be
//! scope creep into a feature that needs its own design. A future issue can
//! add that; until then, restoring a device from backup restores its own
//! metadata, and a second device starts with none.
//!
//! Single-user by construction, matching the "no local multi-user model —
//! the OS sandbox is the boundary" decision from #49: every table skips the
//! `user_id` column the server's equivalent (multi-user) tables have.
//! `Favorite` here has no `user_id` field for the same reason — there is no
//! user to report one for, so omitting it is the honest shape rather than a
//! fabricated constant.

use chrono::Utc;
use librarium_core::error::{AppError, AppResult};
use librarium_types::{EditorMode, UserPreferences};
use serde::Serialize;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::path::Path;
use std::str::FromStr;

/// Mirrors `Bookmark` in `librarium-server/src/models/bookmarks.rs`.
#[derive(Debug, Clone, PartialEq, Serialize, sqlx::FromRow)]
pub struct Bookmark {
    pub id: String,
    pub vault_id: String,
    pub path: String,
    pub title: String,
    pub created_at: String,
}

/// Mirrors `Favorite` in `librarium-server/src/models/favorites.rs`, minus
/// `user_id` (see module doc).
#[derive(Debug, Clone, PartialEq, Serialize, sqlx::FromRow)]
pub struct Favorite {
    pub vault_id: String,
    pub path: String,
    pub created_at: String,
}

fn editor_mode_from_str(value: &str) -> EditorMode {
    match value {
        "raw" => EditorMode::Raw,
        "formatted_raw" => EditorMode::FormattedRaw,
        "fully_rendered" | "wysiwyg" => EditorMode::FullyRendered,
        _ => EditorMode::SideBySide,
    }
}

fn editor_mode_to_str(value: &EditorMode) -> &'static str {
    match value {
        EditorMode::Raw => "raw",
        EditorMode::SideBySide => "side_by_side",
        EditorMode::FormattedRaw => "formatted_raw",
        EditorMode::FullyRendered => "fully_rendered",
    }
}

/// Handle to the local metadata database.
#[derive(Clone)]
pub struct MobileDb {
    pool: SqlitePool,
}

type PrefsRow = (
    String,
    String,
    i64,
    Option<String>,
    Option<String>,
    Option<String>,
);

fn prefs_from_row(row: PrefsRow) -> UserPreferences {
    let (theme, editor_mode, font_size, window_layout, icon_map_raw, color_map_raw) = row;
    UserPreferences {
        theme,
        editor_mode: editor_mode_from_str(&editor_mode),
        font_size: font_size as u16,
        window_layout,
        icon_map: icon_map_raw
            .as_deref()
            .and_then(|raw| serde_json::from_str(raw).ok()),
        color_map: color_map_raw
            .as_deref()
            .and_then(|raw| serde_json::from_str(raw).ok()),
    }
}

impl MobileDb {
    /// Opens (creating if needed) the metadata database at `path` and runs
    /// migrations.
    pub async fn open(path: &Path) -> AppResult<Self> {
        let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display()))
            .map_err(|e| AppError::InternalError(format!("Invalid mobile.db path: {e}")))?
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options)
            .await
            .map_err(AppError::from)?;
        let store = Self { pool };
        store.migrate().await?;
        Ok(store)
    }

    /// In-memory store, used by tests so no real file ever touches disk.
    #[cfg(test)]
    pub async fn open_in_memory() -> AppResult<Self> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .map_err(AppError::from)?;
        let store = Self { pool };
        store.migrate().await?;
        Ok(store)
    }

    async fn migrate(&self) -> AppResult<()> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS preferences (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                theme TEXT NOT NULL,
                editor_mode TEXT NOT NULL,
                font_size INTEGER NOT NULL,
                window_layout TEXT,
                icon_map TEXT,
                color_map TEXT,
                updated_at TEXT NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(AppError::from)?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS recent_files (
                vault_id TEXT NOT NULL,
                path TEXT NOT NULL,
                last_accessed TEXT NOT NULL,
                PRIMARY KEY (vault_id, path)
            )
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(AppError::from)?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS favorites (
                vault_id TEXT NOT NULL,
                path TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (vault_id, path)
            )
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(AppError::from)?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS bookmarks (
                id TEXT PRIMARY KEY NOT NULL,
                vault_id TEXT NOT NULL,
                path TEXT NOT NULL,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(AppError::from)?;

        Ok(())
    }

    // ── Preferences ──────────────────────────────────────────────────────

    /// Returns the stored preferences, or — on a fresh database — inserts
    /// and returns `UserPreferences::default()`. Matches
    /// `GET /api/preferences`'s no-auth fallback path (`user_id: None`)
    /// exactly: a missing/empty DB yields the same defaults the server
    /// returns for a new (unauthenticated) user.
    pub async fn get_preferences(&self) -> AppResult<UserPreferences> {
        let row: Option<PrefsRow> = sqlx::query_as(
            "SELECT theme, editor_mode, font_size, window_layout, icon_map, color_map FROM preferences WHERE id = 1",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(AppError::from)?;

        if let Some(row) = row {
            return Ok(prefs_from_row(row));
        }

        let default = UserPreferences::default();
        self.set_preferences(&default).await?;
        Ok(default)
    }

    pub async fn set_preferences(&self, prefs: &UserPreferences) -> AppResult<()> {
        let mode_str = editor_mode_to_str(&prefs.editor_mode);
        let now = Utc::now().to_rfc3339();
        let icon_map_json = prefs
            .icon_map
            .as_ref()
            .and_then(|m| serde_json::to_string(m).ok());
        let color_map_json = prefs
            .color_map
            .as_ref()
            .and_then(|m| serde_json::to_string(m).ok());

        sqlx::query(
            r#"
            INSERT INTO preferences (id, theme, editor_mode, font_size, window_layout, icon_map, color_map, updated_at)
            VALUES (1, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                theme = excluded.theme,
                editor_mode = excluded.editor_mode,
                font_size = excluded.font_size,
                window_layout = excluded.window_layout,
                icon_map = excluded.icon_map,
                color_map = excluded.color_map,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(&prefs.theme)
        .bind(mode_str)
        .bind(prefs.font_size as i64)
        .bind(&prefs.window_layout)
        .bind(&icon_map_json)
        .bind(&color_map_json)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(AppError::from)?;

        Ok(())
    }

    /// Mirrors `POST /api/preferences/reset`.
    pub async fn reset_preferences(&self) -> AppResult<UserPreferences> {
        let default = UserPreferences::default();
        self.set_preferences(&default).await?;
        Ok(default)
    }

    // ── Recent files ─────────────────────────────────────────────────────

    /// Mirrors `POST /api/vaults/{id}/recent`. Enforces the same 20-entry
    /// cap per vault as the server.
    pub async fn record_recent_file(&self, vault_id: &str, path: &str) -> AppResult<()> {
        sqlx::query(
            r#"
            INSERT INTO recent_files (vault_id, path, last_accessed)
            VALUES (?, ?, ?)
            ON CONFLICT(vault_id, path) DO UPDATE SET last_accessed = excluded.last_accessed
            "#,
        )
        .bind(vault_id)
        .bind(path)
        .bind(Utc::now().to_rfc3339())
        .execute(&self.pool)
        .await
        .map_err(AppError::from)?;

        sqlx::query(
            r#"
            DELETE FROM recent_files
            WHERE vault_id = ? AND path NOT IN (
                SELECT path FROM recent_files
                WHERE vault_id = ?
                ORDER BY last_accessed DESC
                LIMIT 20
            )
            "#,
        )
        .bind(vault_id)
        .bind(vault_id)
        .execute(&self.pool)
        .await
        .map_err(AppError::from)?;

        Ok(())
    }

    /// Mirrors `GET /api/vaults/{id}/recent` (paths only, most recent
    /// first).
    pub async fn list_recent_files(&self, vault_id: &str, limit: i64) -> AppResult<Vec<String>> {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT path FROM recent_files WHERE vault_id = ? ORDER BY last_accessed DESC LIMIT ?",
        )
        .bind(vault_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(AppError::from)?;
        Ok(rows.into_iter().map(|(path,)| path).collect())
    }

    // ── Favorites ────────────────────────────────────────────────────────

    /// Mirrors `GET /api/vaults/{id}/favorites`.
    pub async fn list_favorites(&self, vault_id: &str) -> AppResult<Vec<Favorite>> {
        sqlx::query_as::<_, Favorite>(
            "SELECT vault_id, path, created_at FROM favorites WHERE vault_id = ? ORDER BY created_at DESC",
        )
        .bind(vault_id)
        .fetch_all(&self.pool)
        .await
        .map_err(AppError::from)
    }

    /// Idempotent star, mirroring `POST /api/vaults/{id}/favorites`:
    /// `INSERT OR IGNORE` keeps a double-toggle from ping-ponging
    /// `created_at` — the first star wins its timestamp, and the row is
    /// re-read so the returned value reflects that.
    pub async fn add_favorite(&self, vault_id: &str, path: &str) -> AppResult<Favorite> {
        let created_at = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT OR IGNORE INTO favorites (vault_id, path, created_at) VALUES (?, ?, ?)",
        )
        .bind(vault_id)
        .bind(path)
        .bind(&created_at)
        .execute(&self.pool)
        .await
        .map_err(AppError::from)?;

        sqlx::query_as::<_, Favorite>(
            "SELECT vault_id, path, created_at FROM favorites WHERE vault_id = ? AND path = ?",
        )
        .bind(vault_id)
        .bind(path)
        .fetch_one(&self.pool)
        .await
        .map_err(AppError::from)
    }

    /// Mirrors `DELETE /api/vaults/{id}/favorites?path=...`.
    pub async fn remove_favorite(&self, vault_id: &str, path: &str) -> AppResult<()> {
        sqlx::query("DELETE FROM favorites WHERE vault_id = ? AND path = ?")
            .bind(vault_id)
            .bind(path)
            .execute(&self.pool)
            .await
            .map_err(AppError::from)?;
        Ok(())
    }

    // ── Bookmarks ────────────────────────────────────────────────────────

    /// Mirrors `GET /api/vaults/{id}/bookmarks`.
    pub async fn list_bookmarks(&self, vault_id: &str) -> AppResult<Vec<Bookmark>> {
        sqlx::query_as::<_, Bookmark>(
            "SELECT id, vault_id, path, title, created_at FROM bookmarks WHERE vault_id = ? ORDER BY created_at DESC",
        )
        .bind(vault_id)
        .fetch_all(&self.pool)
        .await
        .map_err(AppError::from)
    }

    /// Mirrors `POST /api/vaults/{id}/bookmarks`.
    pub async fn add_bookmark(
        &self,
        vault_id: &str,
        path: &str,
        title: &str,
    ) -> AppResult<Bookmark> {
        let bookmark = Bookmark {
            id: uuid::Uuid::new_v4().to_string(),
            vault_id: vault_id.to_string(),
            path: path.to_string(),
            title: title.to_string(),
            created_at: Utc::now().to_rfc3339(),
        };
        sqlx::query(
            "INSERT INTO bookmarks (id, vault_id, path, title, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&bookmark.id)
        .bind(&bookmark.vault_id)
        .bind(&bookmark.path)
        .bind(&bookmark.title)
        .bind(&bookmark.created_at)
        .execute(&self.pool)
        .await
        .map_err(AppError::from)?;
        Ok(bookmark)
    }

    /// Mirrors `DELETE /api/vaults/{id}/bookmarks/{bookmark_id}`.
    pub async fn remove_bookmark(&self, vault_id: &str, bookmark_id: &str) -> AppResult<()> {
        sqlx::query("DELETE FROM bookmarks WHERE vault_id = ? AND id = ?")
            .bind(vault_id)
            .bind(bookmark_id)
            .execute(&self.pool)
            .await
            .map_err(AppError::from)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn migrations_run_automatically_on_first_open() {
        // open_in_memory() itself calls migrate(); if any CREATE TABLE
        // statement were missing or malformed, the very first query below
        // would fail rather than this test passing trivially.
        let db = MobileDb::open_in_memory().await.unwrap();
        db.get_preferences().await.unwrap();
        db.list_recent_files("v1", 20).await.unwrap();
        db.list_favorites("v1").await.unwrap();
        db.list_bookmarks("v1").await.unwrap();
    }

    #[tokio::test]
    async fn fresh_db_preferences_match_server_default_for_new_user() {
        let db = MobileDb::open_in_memory().await.unwrap();
        let prefs = db.get_preferences().await.unwrap();
        assert_eq!(prefs, UserPreferences::default());
    }

    #[tokio::test]
    async fn preferences_round_trip_and_reset() {
        let db = MobileDb::open_in_memory().await.unwrap();
        let mut prefs = db.get_preferences().await.unwrap();
        prefs.theme = "light".to_string();
        prefs.font_size = 18;
        db.set_preferences(&prefs).await.unwrap();

        let reloaded = db.get_preferences().await.unwrap();
        assert_eq!(reloaded.theme, "light");
        assert_eq!(reloaded.font_size, 18);

        let reset = db.reset_preferences().await.unwrap();
        assert_eq!(reset, UserPreferences::default());
        assert_eq!(
            db.get_preferences().await.unwrap(),
            UserPreferences::default()
        );
    }

    #[tokio::test]
    async fn recent_files_ordered_most_recent_first_and_capped_at_20() {
        let db = MobileDb::open_in_memory().await.unwrap();
        for i in 0..25 {
            db.record_recent_file("v1", &format!("note-{i}.md"))
                .await
                .unwrap();
        }
        let recent = db.list_recent_files("v1", 20).await.unwrap();
        assert_eq!(recent.len(), 20);
        assert_eq!(recent[0], "note-24.md", "most recently recorded first");
        assert!(!recent.contains(&"note-0.md".to_string()), "oldest evicted");
    }

    #[tokio::test]
    async fn recent_files_scoped_per_vault() {
        let db = MobileDb::open_in_memory().await.unwrap();
        db.record_recent_file("v1", "a.md").await.unwrap();
        db.record_recent_file("v2", "b.md").await.unwrap();
        assert_eq!(db.list_recent_files("v1", 20).await.unwrap(), vec!["a.md"]);
        assert_eq!(db.list_recent_files("v2", 20).await.unwrap(), vec!["b.md"]);
    }

    #[tokio::test]
    async fn favorites_add_list_remove() {
        let db = MobileDb::open_in_memory().await.unwrap();
        let fav = db.add_favorite("v1", "note.md").await.unwrap();
        assert_eq!(fav.path, "note.md");

        let list = db.list_favorites("v1").await.unwrap();
        assert_eq!(list.len(), 1);

        db.remove_favorite("v1", "note.md").await.unwrap();
        assert!(db.list_favorites("v1").await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn favorites_add_is_idempotent_keeps_first_timestamp() {
        let db = MobileDb::open_in_memory().await.unwrap();
        let first = db.add_favorite("v1", "note.md").await.unwrap();
        let second = db.add_favorite("v1", "note.md").await.unwrap();
        assert_eq!(first.created_at, second.created_at);
        assert_eq!(db.list_favorites("v1").await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn bookmarks_add_list_remove() {
        let db = MobileDb::open_in_memory().await.unwrap();
        let bm = db.add_bookmark("v1", "note.md", "My Note").await.unwrap();
        assert_eq!(bm.title, "My Note");

        let list = db.list_bookmarks("v1").await.unwrap();
        assert_eq!(list.len(), 1);

        db.remove_bookmark("v1", &bm.id).await.unwrap();
        assert!(db.list_bookmarks("v1").await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn data_survives_a_simulated_restart() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("mobile.db");

        {
            let db = MobileDb::open(&db_path).await.unwrap();
            let mut prefs = db.get_preferences().await.unwrap();
            prefs.theme = "light".to_string();
            db.set_preferences(&prefs).await.unwrap();
            db.add_favorite("v1", "note.md").await.unwrap();
            db.add_bookmark("v1", "note.md", "My Note").await.unwrap();
            db.record_recent_file("v1", "note.md").await.unwrap();
            // db (and its pool) drops here — simulates the app process exiting.
        }

        let reopened = MobileDb::open(&db_path).await.unwrap();
        assert_eq!(reopened.get_preferences().await.unwrap().theme, "light");
        assert_eq!(reopened.list_favorites("v1").await.unwrap().len(), 1);
        assert_eq!(reopened.list_bookmarks("v1").await.unwrap().len(), 1);
        assert_eq!(
            reopened.list_recent_files("v1", 20).await.unwrap(),
            vec!["note.md"]
        );
    }
}
