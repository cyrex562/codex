//! File and directory commands, backed directly by
//! `librarium_core::file_service::FileService` — the exact same
//! path-traversal-safe implementation the server uses. Every blocking call is
//! wrapped in `spawn_blocking` so it can't stall the Tauri IPC executor.
//!
//! Response shapes mirror the REST endpoints in
//! `librarium-server/src/routes/files.rs` (see the doc comment on each
//! function for which one), since the phase-2 frontend dispatcher depends on
//! both being interchangeable. Server-only side effects — the SQLite change
//! log, the Tantivy search index, WebSocket broadcasts — have no equivalent
//! here: there is no embedded server on mobile.

use chrono::{DateTime, Utc};
use librarium_core::error::{AppError, AppResult};
use librarium_core::file_service::{FileService, RenameStrategy};
use librarium_types::{FileContent, FileNode};
use serde::Serialize;

fn parse_rename_strategy(strategy: Option<&str>) -> RenameStrategy {
    match strategy {
        Some("overwrite") => RenameStrategy::Overwrite,
        Some("autorename") => RenameStrategy::AutoRename,
        _ => RenameStrategy::Fail,
    }
}

/// Mirrors `GET /api/vaults/{id}/files`.
pub async fn file_tree(vault_path: &str) -> AppResult<Vec<FileNode>> {
    let vault_path = vault_path.to_string();
    tokio::task::spawn_blocking(move || FileService::get_file_tree(&vault_path))
        .await
        .map_err(|e| AppError::InternalError(format!("file_tree task join error: {e}")))?
}

/// Mirrors `GET /api/vaults/{id}/files/{path}`.
pub async fn file_read(vault_path: &str, file_path: &str) -> AppResult<FileContent> {
    let vault_path = vault_path.to_string();
    let file_path = file_path.to_string();
    tokio::task::spawn_blocking(move || FileService::read_file(&vault_path, &file_path))
        .await
        .map_err(|e| AppError::InternalError(format!("file_read task join error: {e}")))?
}

/// Mirrors `PUT /api/vaults/{id}/files/{path}`. Unlike the REST endpoint,
/// there is no `If-Match`/ETag conflict check here — that's HTTP-specific
/// concurrency control between independent clients, which doesn't apply to a
/// single on-device app talking to its own local files.
pub async fn file_write(
    vault_path: &str,
    file_path: &str,
    content: &str,
    last_modified: Option<DateTime<Utc>>,
    frontmatter: Option<serde_json::Value>,
) -> AppResult<FileContent> {
    let vault_path = vault_path.to_string();
    let file_path = file_path.to_string();
    let content = content.to_string();
    tokio::task::spawn_blocking(move || {
        FileService::write_file(
            &vault_path,
            &file_path,
            &content,
            last_modified,
            frontmatter.as_ref(),
        )
    })
    .await
    .map_err(|e| AppError::InternalError(format!("file_write task join error: {e}")))?
}

/// Mirrors `POST /api/vaults/{id}/files`.
pub async fn file_create(
    vault_path: &str,
    file_path: &str,
    content: Option<String>,
) -> AppResult<FileContent> {
    let vault_path = vault_path.to_string();
    let file_path = file_path.to_string();
    tokio::task::spawn_blocking(move || {
        FileService::create_file(&vault_path, &file_path, content.as_deref())
    })
    .await
    .map_err(|e| AppError::InternalError(format!("file_create task join error: {e}")))?
}

/// Mirrors `DELETE /api/vaults/{id}/files/{path}` (moves to `.trash/`, same
/// as the server — this is not a permanent delete).
pub async fn file_delete(vault_path: &str, file_path: &str) -> AppResult<()> {
    let vault_path = vault_path.to_string();
    let file_path = file_path.to_string();
    tokio::task::spawn_blocking(move || FileService::delete_file(&vault_path, &file_path))
        .await
        .map_err(|e| AppError::InternalError(format!("file_delete task join error: {e}")))?
}

/// Mirrors the ad-hoc JSON object `POST /api/vaults/{id}/rename` returns:
/// `{"from": ..., "to": ..., "new_path": ...}`.
#[derive(Debug, Clone, Serialize)]
pub struct RenameResult {
    pub from: String,
    pub to: String,
    pub new_path: String,
}

/// Mirrors `POST /api/vaults/{id}/rename`. `strategy` accepts the same
/// strings as the REST endpoint: `"fail"` (default), `"overwrite"`,
/// `"autorename"`.
pub async fn file_rename(
    vault_path: &str,
    from: &str,
    to: &str,
    strategy: Option<&str>,
) -> AppResult<RenameResult> {
    let vault_path = vault_path.to_string();
    let from = from.to_string();
    let to = to.to_string();
    let strategy = parse_rename_strategy(strategy);
    tokio::task::spawn_blocking(move || {
        let new_path = FileService::rename(&vault_path, &from, &to, strategy)?;
        Ok(RenameResult {
            from,
            to: new_path.clone(),
            new_path,
        })
    })
    .await
    .map_err(|e| AppError::InternalError(format!("file_rename task join error: {e}")))?
}

/// Mirrors the ad-hoc JSON object `POST /api/vaults/{id}/directories`
/// returns: `{"path": ...}`.
#[derive(Debug, Clone, Serialize)]
pub struct DirectoryCreateResult {
    pub path: String,
}

/// Mirrors `POST /api/vaults/{id}/directories`.
pub async fn directory_create(
    vault_path: &str,
    dir_path: &str,
) -> AppResult<DirectoryCreateResult> {
    let vault_path = vault_path.to_string();
    let dir_path = dir_path.to_string();
    tokio::task::spawn_blocking(move || {
        FileService::create_directory(&vault_path, &dir_path)?;
        Ok(DirectoryCreateResult { path: dir_path })
    })
    .await
    .map_err(|e| AppError::InternalError(format!("directory_create task join error: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn vault() -> TempDir {
        TempDir::new().unwrap()
    }

    #[tokio::test]
    async fn file_tree_lists_files_and_directories() {
        let vault = vault();
        std::fs::write(vault.path().join("note.md"), "# Hi").unwrap();
        std::fs::create_dir(vault.path().join("folder")).unwrap();

        let tree = file_tree(vault.path().to_str().unwrap()).await.unwrap();
        assert_eq!(tree.len(), 2);
        assert!(tree.iter().any(|n| n.name == "note.md" && !n.is_directory));
        assert!(tree.iter().any(|n| n.name == "folder" && n.is_directory));
    }

    #[tokio::test]
    async fn file_create_then_read_round_trips_content() {
        let vault = vault();
        let vault_path = vault.path().to_str().unwrap();

        let created = file_create(vault_path, "note.md", Some("hello".to_string()))
            .await
            .unwrap();
        assert_eq!(created.content, "hello");

        let read = file_read(vault_path, "note.md").await.unwrap();
        assert_eq!(read.content, "hello");
        assert_eq!(read.path, "note.md");
    }

    #[tokio::test]
    async fn file_write_updates_existing_content() {
        let vault = vault();
        let vault_path = vault.path().to_str().unwrap();
        file_create(vault_path, "note.md", Some("v1".to_string()))
            .await
            .unwrap();

        let written = file_write(vault_path, "note.md", "v2", None, None)
            .await
            .unwrap();
        assert_eq!(written.content, "v2");
    }

    #[tokio::test]
    async fn file_delete_moves_to_trash_not_permanent() {
        let vault = vault();
        let vault_path = vault.path().to_str().unwrap();
        file_create(vault_path, "note.md", Some("bye".to_string()))
            .await
            .unwrap();

        file_delete(vault_path, "note.md").await.unwrap();
        assert!(!vault.path().join("note.md").exists());
        assert!(vault.path().join(".trash").is_dir());
    }

    #[tokio::test]
    async fn file_rename_moves_file_and_reports_new_path() {
        let vault = vault();
        let vault_path = vault.path().to_str().unwrap();
        file_create(vault_path, "old.md", Some("content".to_string()))
            .await
            .unwrap();

        let result = file_rename(vault_path, "old.md", "new.md", None)
            .await
            .unwrap();
        assert_eq!(result.from, "old.md");
        assert_eq!(result.new_path, "new.md");
        assert!(vault.path().join("new.md").exists());
        assert!(!vault.path().join("old.md").exists());
    }

    #[tokio::test]
    async fn directory_create_makes_a_directory() {
        let vault = vault();
        let vault_path = vault.path().to_str().unwrap();

        let result = directory_create(vault_path, "sub/folder").await.unwrap();
        assert_eq!(result.path, "sub/folder");
        assert!(vault.path().join("sub/folder").is_dir());
    }

    // ── Path-traversal rejection ────────────────────────────────────────────
    // FileService::resolve_path is the single choke point all of these route
    // through; these tests exist so a future change to any command here can't
    // silently drop that call and reopen a traversal hole.

    #[tokio::test]
    async fn file_read_rejects_path_traversal() {
        let vault = vault();
        let vault_path = vault.path().to_str().unwrap();
        let err = file_read(vault_path, "../outside.md").await.unwrap_err();
        assert!(matches!(err, AppError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn file_write_rejects_path_traversal() {
        let vault = vault();
        let vault_path = vault.path().to_str().unwrap();
        let err = file_write(vault_path, "../../outside.md", "x", None, None)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn file_create_rejects_path_traversal() {
        let vault = vault();
        let vault_path = vault.path().to_str().unwrap();
        let err = file_create(vault_path, "../outside.md", None)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn file_delete_rejects_path_traversal() {
        let vault = vault();
        let vault_path = vault.path().to_str().unwrap();
        let err = file_delete(vault_path, "../outside.md").await.unwrap_err();
        assert!(matches!(err, AppError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn file_rename_rejects_path_traversal_on_either_side() {
        let vault = vault();
        let vault_path = vault.path().to_str().unwrap();
        file_create(vault_path, "note.md", Some("x".to_string()))
            .await
            .unwrap();

        let err = file_rename(vault_path, "note.md", "../outside.md", None)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::InvalidInput(_)));

        let err = file_rename(vault_path, "../outside.md", "note2.md", None)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn directory_create_rejects_path_traversal() {
        let vault = vault();
        let vault_path = vault.path().to_str().unwrap();
        let err = directory_create(vault_path, "../outside")
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn file_tree_on_missing_vault_path_is_not_found() {
        let err = file_tree("/definitely/does/not/exist").await.unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }
}
