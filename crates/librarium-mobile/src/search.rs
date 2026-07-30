//! On-device full-text search and index lifecycle, backed directly by
//! `librarium_core::search_service::SearchIndex` — the exact same Tantivy
//! wrapper the server uses, just supplied an app-private index directory
//! instead of the server's `LIBRARIUM_INDEX_DIR`/`./data/indices` (see that
//! crate's doc comment on `with_index_dir`).
//!
//! Unlike `vault`/`file`/`render`/`links`/`tags`/`frontmatter`, these
//! functions are **not** stateless: a `SearchIndex` holds open Tantivy
//! `Index`/`IndexReader` handles per vault in memory, so callers must reuse
//! one long-lived instance across calls rather than constructing a fresh one
//! per command (a fresh instance's in-memory map starts empty even if a
//! valid index already exists on disk, so `search()` would report "vault
//! index not found" for anything it hasn't `build_index`'d itself first). The
//! eventual Tauri app registers one via `app.manage(SearchIndex::with_index_dir(...))`
//! and commands extract it with `tauri::State<'_, SearchIndex>` — this module
//! only requires `&SearchIndex`, so tests construct their own throwaway
//! instance per test.
//!
//! `search`/`search_paged` and `rebuild_index`/`index_size_on_disk` are
//! exposed as `#[tauri::command]`s in `commands.rs` — all four are direct,
//! user-triggerable actions (search-as-you-type, a "rebuild index" settings
//! action, the settings UI showing index size). `build_index` and
//! `update_incremental` are deliberately plain `pub async fn`s with no
//! command wrapper: nothing in the frontend calls these directly — they're
//! meant to be invoked by `librarium-sync`'s applied-change stream once that
//! wiring exists (#53), not over Tauri IPC. Hooking to that stream, rather
//! than running a second `notify` watcher alongside the sync engine's own
//! one, is what the issue asks for; #53 isn't built yet, so this only
//! provides the functions #53 will call, tested as if it already did.

use librarium_core::error::AppResult;
use librarium_core::search_service::SearchIndex;
use librarium_types::PagedSearchResult;
use std::path::Path;

const DEFAULT_PAGE: usize = 1;
const DEFAULT_PAGE_SIZE: usize = 50;

/// Mirrors `GET /api/vaults/{id}/search` using the server's own pagination
/// defaults (page 1, 50 results) — for a caller that doesn't need to manage
/// pagination itself.
pub async fn search(
    index: &SearchIndex,
    vault_id: &str,
    query: &str,
) -> AppResult<PagedSearchResult> {
    search_paged(index, vault_id, query, DEFAULT_PAGE, DEFAULT_PAGE_SIZE).await
}

/// Mirrors `GET /api/vaults/{id}/search` with explicit pagination — the same
/// `SearchIndex::search` call the REST handler makes, so result shape and
/// ranking are identical by construction, not by parity testing.
pub async fn search_paged(
    index: &SearchIndex,
    vault_id: &str,
    query: &str,
    page: usize,
    page_size: usize,
) -> AppResult<PagedSearchResult> {
    let index = index.clone();
    let vault_id = vault_id.to_string();
    let query = query.to_string();
    tokio::task::spawn_blocking(move || index.search(&vault_id, &query, page, page_size))
        .await
        .map_err(|e| {
            librarium_core::error::AppError::InternalError(format!("search task join error: {e}"))
        })?
}

/// Builds (or, per `index_vault`'s own manifest-diff logic, incrementally
/// updates) the on-device index for `vault_id` against `vault_path`. Returns
/// `Ok(None)` without touching the index or the filesystem at all when
/// `local_search_enabled` is `false` — the off switch this issue requires
/// ("no Tantivy index is created"). Meant to run once after the first
/// successful sync, per the issue; called directly (not a command) since
/// nothing in the frontend triggers this — the sync engine does, once #53
/// wires it up.
pub async fn build_index(
    index: &SearchIndex,
    vault_id: &str,
    vault_path: &str,
    local_search_enabled: bool,
) -> AppResult<Option<usize>> {
    if !local_search_enabled {
        return Ok(None);
    }
    let index = index.clone();
    let vault_id = vault_id.to_string();
    let vault_path = vault_path.to_string();
    let count = tokio::task::spawn_blocking(move || index.index_vault(&vault_id, &vault_path))
        .await
        .map_err(|e| {
            librarium_core::error::AppError::InternalError(format!(
                "build_index task join error: {e}"
            ))
        })??;
    Ok(Some(count))
}

/// Applies specific changed files to the index without a full vault walk —
/// what the sync engine's applied-change stream calls per batch of synced
/// files, once #53 exists to call it. `files` is `(vault-relative path, new
/// content)` for created/modified files.
pub async fn update_incremental(
    index: &SearchIndex,
    vault_id: &str,
    files: Vec<(String, String)>,
) -> AppResult<()> {
    let index = index.clone();
    let vault_id = vault_id.to_string();
    tokio::task::spawn_blocking(move || index.update_files_batch(&vault_id, &files))
        .await
        .map_err(|e| {
            librarium_core::error::AppError::InternalError(format!(
                "update_incremental task join error: {e}"
            ))
        })?
}

/// Force a full rebuild: drops the in-memory index handle (so no open
/// Tantivy file handles outlive the delete below), deletes `vault_id`'s
/// on-disk index directory (which also clears its incremental manifest —
/// the next `index_vault` sees no previous manifest and reindexes
/// everything), then rebuilds from scratch. Idempotent: safe to call with no
/// prior index for `vault_id` at all.
pub async fn rebuild_index(
    index: &SearchIndex,
    index_dir: &Path,
    vault_id: &str,
    vault_path: &str,
) -> AppResult<usize> {
    index.remove_vault(vault_id)?;

    let index = index.clone();
    let index_dir = index_dir.to_path_buf();
    let vault_id = vault_id.to_string();
    let vault_path = vault_path.to_string();
    tokio::task::spawn_blocking(move || {
        let vault_index_dir = index_dir.join(&vault_id);
        if vault_index_dir.exists() {
            std::fs::remove_dir_all(&vault_index_dir)?;
        }
        index.index_vault(&vault_id, &vault_path)
    })
    .await
    .map_err(|e| {
        librarium_core::error::AppError::InternalError(format!(
            "rebuild_index task join error: {e}"
        ))
    })?
}

/// Total on-disk size, in bytes, of `vault_id`'s index directory under
/// `index_dir` — for the settings UI to display, per the issue. `0` when no
/// index has been built yet, not an error.
pub async fn index_size_on_disk(index_dir: &Path, vault_id: &str) -> AppResult<u64> {
    let index_dir = index_dir.to_path_buf();
    let vault_id = vault_id.to_string();
    tokio::task::spawn_blocking(move || {
        let vault_index_dir = index_dir.join(&vault_id);
        let mut total = 0u64;
        for entry in walkdir::WalkDir::new(&vault_index_dir)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    total += meta.len();
                }
            }
        }
        Ok(total)
    })
    .await
    .map_err(|e| {
        librarium_core::error::AppError::InternalError(format!(
            "index_size_on_disk task join error: {e}"
        ))
    })?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_note(dir: &Path, name: &str, content: &str) {
        std::fs::write(dir.join(name), content).unwrap();
    }

    #[tokio::test]
    async fn build_index_then_search_finds_note() {
        let vault = TempDir::new().unwrap();
        write_note(vault.path(), "note.md", "# Rust\n\nOffline search works.");
        let index_store = TempDir::new().unwrap();
        let index = SearchIndex::with_index_dir(Some(index_store.path().to_path_buf()));

        let count = build_index(&index, "v1", vault.path().to_str().unwrap(), true)
            .await
            .unwrap();
        assert_eq!(count, Some(1));

        let result = search(&index, "v1", "offline").await.unwrap();
        assert_eq!(result.results.len(), 1);
        assert_eq!(result.results[0].path, "note.md");
    }

    #[tokio::test]
    async fn build_index_disabled_creates_nothing() {
        let vault = TempDir::new().unwrap();
        write_note(vault.path(), "note.md", "content");
        let index_store = TempDir::new().unwrap();
        let index = SearchIndex::with_index_dir(Some(index_store.path().to_path_buf()));

        let count = build_index(&index, "v1", vault.path().to_str().unwrap(), false)
            .await
            .unwrap();
        assert_eq!(count, None);
        assert!(
            !index_store.path().join("v1").exists(),
            "no index directory should be created when disabled"
        );

        // Confirms the index is genuinely absent, not just unpopulated: a
        // search against a never-built vault is a clean NotFound, not an
        // empty-but-valid result set.
        let err = search(&index, "v1", "content").await.unwrap_err();
        assert!(matches!(err, librarium_core::error::AppError::NotFound(_)));
    }

    #[tokio::test]
    async fn search_paged_respects_page_size() {
        let vault = TempDir::new().unwrap();
        for i in 0..5 {
            write_note(vault.path(), &format!("note-{i}.md"), "shared keyword");
        }
        let index_store = TempDir::new().unwrap();
        let index = SearchIndex::with_index_dir(Some(index_store.path().to_path_buf()));
        build_index(&index, "v1", vault.path().to_str().unwrap(), true)
            .await
            .unwrap();

        let page1 = search_paged(&index, "v1", "keyword", 1, 2).await.unwrap();
        assert_eq!(page1.results.len(), 2);
        assert_eq!(page1.total_count, 5);
    }

    #[tokio::test]
    async fn update_incremental_makes_new_content_findable_without_full_rebuild() {
        let vault = TempDir::new().unwrap();
        write_note(vault.path(), "note.md", "original content");
        let index_store = TempDir::new().unwrap();
        let index = SearchIndex::with_index_dir(Some(index_store.path().to_path_buf()));
        build_index(&index, "v1", vault.path().to_str().unwrap(), true)
            .await
            .unwrap();

        // Simulates a file synced in from the remote by librarium-sync,
        // without re-walking the vault (build_index/index_vault is not
        // called again here).
        update_incremental(
            &index,
            "v1",
            vec![(
                "synced.md".to_string(),
                "freshly synced content".to_string(),
            )],
        )
        .await
        .unwrap();

        let result = search(&index, "v1", "freshly synced").await.unwrap();
        assert_eq!(result.results.len(), 1);
        assert_eq!(result.results[0].path, "synced.md");
    }

    #[tokio::test]
    async fn rebuild_index_is_idempotent_and_reflects_current_files() {
        let vault = TempDir::new().unwrap();
        write_note(vault.path(), "old.md", "stale");
        let index_store = TempDir::new().unwrap();
        let index = SearchIndex::with_index_dir(Some(index_store.path().to_path_buf()));
        build_index(&index, "v1", vault.path().to_str().unwrap(), true)
            .await
            .unwrap();

        // Change the vault on disk after the first build, then rebuild from
        // scratch — the rebuilt index must reflect the new file set exactly,
        // not merge with the old one.
        std::fs::remove_file(vault.path().join("old.md")).unwrap();
        write_note(vault.path(), "new.md", "fresh");

        let count = rebuild_index(
            &index,
            index_store.path(),
            "v1",
            vault.path().to_str().unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(count, 1);

        let result = search(&index, "v1", "fresh").await.unwrap();
        assert_eq!(result.results.len(), 1);
        let stale = search(&index, "v1", "stale").await.unwrap();
        assert!(stale.results.is_empty());

        // Idempotent: calling again with no changes must not error or
        // duplicate results.
        rebuild_index(
            &index,
            index_store.path(),
            "v1",
            vault.path().to_str().unwrap(),
        )
        .await
        .unwrap();
        let result = search(&index, "v1", "fresh").await.unwrap();
        assert_eq!(result.results.len(), 1);
    }

    #[tokio::test]
    async fn index_size_on_disk_zero_before_build_nonzero_after() {
        let vault = TempDir::new().unwrap();
        write_note(vault.path(), "note.md", "some content to index");
        let index_store = TempDir::new().unwrap();
        let index = SearchIndex::with_index_dir(Some(index_store.path().to_path_buf()));

        let before = index_size_on_disk(index_store.path(), "v1").await.unwrap();
        assert_eq!(before, 0);

        build_index(&index, "v1", vault.path().to_str().unwrap(), true)
            .await
            .unwrap();
        let after = index_size_on_disk(index_store.path(), "v1").await.unwrap();
        assert!(after > 0, "expected nonzero index size after build");
    }
}

#[cfg(test)]
mod build_time_measurement {
    use super::*;
    use std::time::Instant;
    use tempfile::TempDir;

    /// Not a correctness test, and NOT the measurement the issue's acceptance
    /// criteria actually require ("needs a device or emulator... may land as
    /// a follow-up comment after #63") — this is a desktop-CPU, debug-build
    /// number that can only be directional. Run with `cargo test -p
    /// librarium-mobile -- --ignored --nocapture measure_index_build_on_1k_notes`.
    #[tokio::test]
    #[ignore = "manual measurement, not a correctness check, not the device measurement the issue asks for"]
    async fn measure_index_build_on_1k_notes() {
        let vault = TempDir::new().unwrap();
        for i in 0..1000 {
            let content = format!(
                "---\ntags: [note{}, shared]\n---\n# Note {i}\n\nSome body text about topic {} with enough words to be realistic. See [[Note {}]].\n",
                i % 50,
                i % 30,
                (i + 1) % 1000,
            );
            std::fs::write(vault.path().join(format!("note-{i:04}.md")), content).unwrap();
        }
        let index_store = TempDir::new().unwrap();
        let index = SearchIndex::with_index_dir(Some(index_store.path().to_path_buf()));

        let start = Instant::now();
        let count = build_index(&index, "v1", vault.path().to_str().unwrap(), true)
            .await
            .unwrap();
        let elapsed = start.elapsed();
        let size = index_size_on_disk(index_store.path(), "v1").await.unwrap();

        println!(
            "1000-note vault: build_index = {:?} ({:?} files), on-disk size = {} bytes ({:.2} MiB)",
            elapsed,
            count,
            size,
            size as f64 / (1024.0 * 1024.0)
        );
    }
}
