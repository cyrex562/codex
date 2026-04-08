use crate::db::Database;
use crate::error::AppResult;
use crate::services::entity_service::EntityService;
use crate::services::relation_service::RelationService;
use chrono::Utc;
use std::path::Path;
use tokio::fs;
use tracing::{debug, error, info, warn};

pub struct ReindexService;

impl ReindexService {
    /// Full two-pass reindex for a vault.
    ///
    /// Pass 1: Walk vault directory, parse frontmatter, upsert entities.
    ///         Remove stale entities (path on disk deleted since last index).
    /// Pass 2: For every entity just indexed, sync relations from fields.
    ///         Unresolved refs are silently dropped (fixed on a subsequent run).
    pub async fn reindex_vault(db: &Database, vault_id: &str, vault_path: &str) -> AppResult<()> {
        let start = Utc::now();
        info!("Starting reindex of vault {vault_id} at {vault_path}");

        // --- Pass 1: index all entities ---
        let md_files = collect_md_files(vault_path).await;

        let mut indexed_count = 0usize;
        let mut error_count = 0usize;
        let mut visited_paths: Vec<String> = Vec::new();

        for abs_path in &md_files {
            let rel_path = match abs_path.strip_prefix(vault_path) {
                Some(p) => p
                    .trim_start_matches('/')
                    .to_string(),
                None => {
                    warn!("Could not make {abs_path} relative to {vault_path}");
                    continue;
                }
            };

            let content = match fs::read_to_string(abs_path).await {
                Ok(c) => c,
                Err(e) => {
                    warn!("Failed to read {abs_path}: {e}");
                    error_count += 1;
                    continue;
                }
            };

            // Parse frontmatter
            if let Some(fm) = EntityService::parse_frontmatter(&content) {
                // Only upsert if it has a codex_type
                if fm.get("codex_type").is_some() {
                    // Use file modification time
                    let modified_at = tokio::fs::metadata(abs_path)
                        .await
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .map(|t| {
                            let dt: chrono::DateTime<Utc> = t.into();
                            dt.to_rfc3339()
                        })
                        .unwrap_or_else(|| Utc::now().to_rfc3339());

                    match EntityService::upsert(db, vault_id, &rel_path, &fm, &modified_at, None).await {
                        Ok(Some(_)) => {
                            indexed_count += 1;
                            visited_paths.push(rel_path);
                        }
                        Ok(None) => {}
                        Err(e) => {
                            error!("Failed to upsert entity at {rel_path}: {e}");
                            error_count += 1;
                        }
                    }
                }
            }
        }

        // Remove stale entities (files deleted since last index)
        let known_paths = EntityService::get_indexed_paths(db, vault_id).await?;
        for stale_path in known_paths {
            if !visited_paths.contains(&stale_path) {
                debug!("Removing stale entity at {stale_path}");
                if let Err(e) = EntityService::remove(db, vault_id, &stale_path).await {
                    warn!("Failed to remove stale entity {stale_path}: {e}");
                }
            }
        }

        info!("Reindex pass 1 complete: {indexed_count} indexed, {error_count} errors");

        // --- Pass 2: sync relations ---
        let entities = crate::services::entity_service::EntityService::list_all_in_vault(db, vault_id).await?;
        let mut rel_errors = 0usize;
        for entity in &entities {
            if let Err(e) = RelationService::sync_from_entity(db, entity, None).await {
                warn!("Failed to sync relations for {}: {e}", entity.path);
                rel_errors += 1;
            }
        }

        let elapsed = Utc::now()
            .signed_duration_since(start)
            .num_milliseconds();

        info!(
            "Reindex complete for vault {vault_id}: {} entities, {} relations synced, {rel_errors} relation errors, {elapsed}ms",
            indexed_count,
            entities.len()
        );

        // Log to reindex_log
        let _ = sqlx::query(
            r#"
            INSERT INTO reindex_log (vault_id, started_at, finished_at, files_indexed, errors)
            VALUES (?, ?, ?, ?, ?)
            "#,
        )
        .bind(vault_id)
        .bind(start.to_rfc3339())
        .bind(Utc::now().to_rfc3339())
        .bind(indexed_count as i64)
        .bind((error_count + rel_errors) as i64)
        .execute(db.pool())
        .await;

        Ok(())
    }

    /// Trigger re-sync of a single file's entity + relations.
    /// Called from the file-watcher event loop on Create/Modify events.
    pub async fn index_file(
        db: &Database,
        vault_id: &str,
        rel_path: &str,
        abs_path: &str,
    ) -> AppResult<()> {
        let content = match fs::read_to_string(abs_path).await {
            Ok(c) => c,
            Err(e) => {
                warn!("index_file: failed to read {abs_path}: {e}");
                return Ok(()); // Not a fatal error
            }
        };

        if let Some(fm) = EntityService::parse_frontmatter(&content) {
            if fm.get("codex_type").is_some() {
                let modified_at = tokio::fs::metadata(abs_path)
                    .await
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .map(|t| {
                        let dt: chrono::DateTime<Utc> = t.into();
                        dt.to_rfc3339()
                    })
                    .unwrap_or_else(|| Utc::now().to_rfc3339());

                if let Ok(Some(entity)) =
                    EntityService::upsert(db, vault_id, rel_path, &fm, &modified_at, None).await
                {
                    RelationService::sync_from_entity(db, &entity, None).await?;
                }
                return Ok(());
            }
        }

        // File has no codex_type frontmatter — remove entity if it existed before
        // (user may have removed the codex_type key)
        EntityService::remove(db, vault_id, rel_path).await?;
        Ok(())
    }

    /// Remove entity + relations for a deleted file.
    /// Called from the file-watcher event loop on Delete events.
    pub async fn remove_file(db: &Database, vault_id: &str, rel_path: &str) -> AppResult<()> {
        EntityService::remove(db, vault_id, rel_path).await
    }
}

/// Recursively collect all `.md` files under `root`, skipping hidden directories
/// and the standard exclusion list.
async fn collect_md_files(root: &str) -> Vec<String> {
    let excluded_dirs = [".git", ".obsidian", ".trash", "node_modules", ".codex"];
    let mut results = Vec::new();
    collect_recursive(Path::new(root), &excluded_dirs, &mut results).await;
    results
}

fn collect_recursive<'a>(
    dir: &'a Path,
    excluded: &'a [&'a str],
    results: &'a mut Vec<String>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'a>> {
    Box::pin(async move {
        let mut read_dir = match tokio::fs::read_dir(dir).await {
            Ok(r) => r,
            Err(_) => return,
        };
        while let Ok(Some(entry)) = read_dir.next_entry().await {
            let path = entry.path();
            if path.is_dir() {
                let name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("");
                if name.starts_with('.') || excluded.contains(&name) {
                    continue;
                }
                collect_recursive(&path, excluded, results).await;
            } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
                results.push(path.to_string_lossy().into_owned());
            }
        }
    })
}
