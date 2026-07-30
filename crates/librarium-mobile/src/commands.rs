//! `#[tauri::command]` wrappers around the plain, Tauri-free functions in
//! [`crate::vault`] and [`crate::file`].
//!
//! These wrapper functions are deliberately **not** `pub`: with the
//! `tauri`/`tauri-macros` versions this workspace pins, a `pub fn` annotated
//! with `#[tauri::command]` fails to compile (`E0255`, "defined multiple
//! times") — the macro's generated dispatch shim collides with itself once
//! the function is publicly reachable. Every command in the working
//! `librarium-tauri` desktop shell is private for the same reason. Visibility
//! isn't needed here anyway: [`invoke_handler`] is the crate's only public
//! entry point, and `tauri::generate_handler!` only needs same-module access.
//!
//! Every command is generic over `R: tauri::Runtime` rather than tied to the
//! desktop `Wry` runtime (this crate builds with `tauri`'s default features,
//! including `wry`, off — see Cargo.toml), so the same command layer can be
//! registered by both a desktop and a mobile host app.
//!
//! Vault-root resolution goes through Tauri's path API
//! (`AppHandle::path().app_config_dir()`), never a CWD-relative path — this
//! is what makes app-private storage on Android work, and it's the only
//! reason this module needs a live `AppHandle` at all. The actual command
//! logic in `vault`/`file` takes plain paths and has no Tauri dependency.

use crate::file::{DirectoryCreateResult, RenameResult};
use crate::links::{LinkedNote, ResolveWikiLinkResult};
use crate::metadata::{Bookmark, Favorite, MobileDb};
use crate::sync::{PairingInfo, RemoteDto, SyncHandle};
use crate::tags::TagEntry;
use librarium_core::search_service::SearchIndex;
use librarium_sync::VaultStatus;
use librarium_types::{FileContent, FileNode, PagedSearchResult, UserPreferences, Vault};
use tauri::{AppHandle, Manager, Runtime, State};

fn app_config_dir<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("Could not resolve app config directory: {e}"))
}

/// Search index storage lives under app-private data (not config) storage —
/// a distinct directory from the vault registry, mirroring the server's own
/// separation between its SQLite/config location and `./data/indices`.
fn search_index_dir<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("search-index"))
        .map_err(|e| format!("Could not resolve app data directory: {e}"))
}

async fn resolve_vault_path<R: Runtime>(
    app: &AppHandle<R>,
    vault_id: &str,
) -> Result<String, String> {
    let config_dir = app_config_dir(app)?;
    crate::vault::vault_get(&config_dir, vault_id)
        .await
        .map(|v| v.path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn vault_list<R: Runtime>(app: AppHandle<R>) -> Result<Vec<Vault>, String> {
    let config_dir = app_config_dir(&app)?;
    crate::vault::vault_list(&config_dir)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn vault_get<R: Runtime>(app: AppHandle<R>, vault_id: String) -> Result<Vault, String> {
    let config_dir = app_config_dir(&app)?;
    crate::vault::vault_get(&config_dir, &vault_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn file_tree<R: Runtime>(
    app: AppHandle<R>,
    vault_id: String,
) -> Result<Vec<FileNode>, String> {
    let vault_path = resolve_vault_path(&app, &vault_id).await?;
    crate::file::file_tree(&vault_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn file_read<R: Runtime>(
    app: AppHandle<R>,
    vault_id: String,
    file_path: String,
) -> Result<FileContent, String> {
    let vault_path = resolve_vault_path(&app, &vault_id).await?;
    crate::file::file_read(&vault_path, &file_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn file_write<R: Runtime>(
    app: AppHandle<R>,
    vault_id: String,
    file_path: String,
    content: String,
    last_modified: Option<chrono::DateTime<chrono::Utc>>,
    frontmatter: Option<serde_json::Value>,
) -> Result<FileContent, String> {
    let vault_path = resolve_vault_path(&app, &vault_id).await?;
    crate::file::file_write(
        &vault_path,
        &file_path,
        &content,
        last_modified,
        frontmatter,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn file_create<R: Runtime>(
    app: AppHandle<R>,
    vault_id: String,
    file_path: String,
    content: Option<String>,
) -> Result<FileContent, String> {
    let vault_path = resolve_vault_path(&app, &vault_id).await?;
    crate::file::file_create(&vault_path, &file_path, content)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn file_delete<R: Runtime>(
    app: AppHandle<R>,
    vault_id: String,
    file_path: String,
) -> Result<(), String> {
    let vault_path = resolve_vault_path(&app, &vault_id).await?;
    crate::file::file_delete(&vault_path, &file_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn file_rename<R: Runtime>(
    app: AppHandle<R>,
    vault_id: String,
    from: String,
    to: String,
    strategy: Option<String>,
) -> Result<RenameResult, String> {
    let vault_path = resolve_vault_path(&app, &vault_id).await?;
    crate::file::file_rename(&vault_path, &from, &to, strategy.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn directory_create<R: Runtime>(
    app: AppHandle<R>,
    vault_id: String,
    dir_path: String,
) -> Result<DirectoryCreateResult, String> {
    let vault_path = resolve_vault_path(&app, &vault_id).await?;
    crate::file::directory_create(&vault_path, &dir_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn render_markdown(content: String) -> Result<String, String> {
    Ok(crate::render::render_markdown(&content).await)
}

#[tauri::command]
async fn render_markdown_in_vault<R: Runtime>(
    app: AppHandle<R>,
    vault_id: String,
    content: String,
    current_file: Option<String>,
) -> Result<String, String> {
    let vault_path = resolve_vault_path(&app, &vault_id).await?;
    Ok(
        crate::render::render_markdown_in_vault(&vault_path, &content, current_file.as_deref())
            .await,
    )
}

#[tauri::command]
async fn resolve_wiki_link<R: Runtime>(
    app: AppHandle<R>,
    vault_id: String,
    link: String,
    current_file: Option<String>,
) -> Result<ResolveWikiLinkResult, String> {
    let vault_path = resolve_vault_path(&app, &vault_id).await?;
    crate::links::resolve_wiki_link(&vault_path, &link, current_file.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn backlinks<R: Runtime>(
    app: AppHandle<R>,
    vault_id: String,
    path: String,
) -> Result<Vec<LinkedNote>, String> {
    let vault_path = resolve_vault_path(&app, &vault_id).await?;
    crate::links::backlinks(&vault_path, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn outgoing_links<R: Runtime>(
    app: AppHandle<R>,
    vault_id: String,
    file_path: String,
) -> Result<Vec<LinkedNote>, String> {
    let vault_path = resolve_vault_path(&app, &vault_id).await?;
    crate::links::outgoing_links(&vault_path, &file_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn tags_list<R: Runtime>(
    app: AppHandle<R>,
    vault_id: String,
) -> Result<Vec<TagEntry>, String> {
    let vault_path = resolve_vault_path(&app, &vault_id).await?;
    crate::tags::tags_list(&vault_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn tag_files<R: Runtime>(
    app: AppHandle<R>,
    vault_id: String,
    tag: String,
) -> Result<Vec<String>, String> {
    let vault_path = resolve_vault_path(&app, &vault_id).await?;
    crate::tags::tag_files(&vault_path, &tag)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn frontmatter_read<R: Runtime>(
    app: AppHandle<R>,
    vault_id: String,
    file_path: String,
) -> Result<Option<serde_json::Value>, String> {
    let vault_path = resolve_vault_path(&app, &vault_id).await?;
    crate::frontmatter::frontmatter_read(&vault_path, &file_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn frontmatter_write<R: Runtime>(
    app: AppHandle<R>,
    vault_id: String,
    file_path: String,
    frontmatter: Option<serde_json::Value>,
) -> Result<FileContent, String> {
    let vault_path = resolve_vault_path(&app, &vault_id).await?;
    crate::frontmatter::frontmatter_write(&vault_path, &file_path, frontmatter)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn search(
    index: State<'_, SearchIndex>,
    vault_id: String,
    query: String,
) -> Result<PagedSearchResult, String> {
    crate::search::search(&index, &vault_id, &query)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn search_paged(
    index: State<'_, SearchIndex>,
    vault_id: String,
    query: String,
    page: usize,
    page_size: usize,
) -> Result<PagedSearchResult, String> {
    crate::search::search_paged(&index, &vault_id, &query, page, page_size)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn search_index_rebuild<R: Runtime>(
    app: AppHandle<R>,
    index: State<'_, SearchIndex>,
    vault_id: String,
) -> Result<usize, String> {
    let vault_path = resolve_vault_path(&app, &vault_id).await?;
    let index_dir = search_index_dir(&app)?;
    crate::search::rebuild_index(&index, &index_dir, &vault_id, &vault_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn search_index_size<R: Runtime>(app: AppHandle<R>, vault_id: String) -> Result<u64, String> {
    let index_dir = search_index_dir(&app)?;
    crate::search::index_size_on_disk(&index_dir, &vault_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn preferences_get(db: State<'_, MobileDb>) -> Result<UserPreferences, String> {
    db.get_preferences().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn preferences_set(
    db: State<'_, MobileDb>,
    preferences: UserPreferences,
) -> Result<(), String> {
    db.set_preferences(&preferences)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn preferences_reset(db: State<'_, MobileDb>) -> Result<UserPreferences, String> {
    db.reset_preferences().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn recent_list(db: State<'_, MobileDb>, vault_id: String) -> Result<Vec<String>, String> {
    db.list_recent_files(&vault_id, 20)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn recent_record(
    db: State<'_, MobileDb>,
    vault_id: String,
    path: String,
) -> Result<(), String> {
    db.record_recent_file(&vault_id, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn favorites_list(
    db: State<'_, MobileDb>,
    vault_id: String,
) -> Result<Vec<Favorite>, String> {
    db.list_favorites(&vault_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn favorites_add(
    db: State<'_, MobileDb>,
    vault_id: String,
    path: String,
) -> Result<Favorite, String> {
    db.add_favorite(&vault_id, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn favorites_remove(
    db: State<'_, MobileDb>,
    vault_id: String,
    path: String,
) -> Result<(), String> {
    db.remove_favorite(&vault_id, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn bookmarks_list(
    db: State<'_, MobileDb>,
    vault_id: String,
) -> Result<Vec<Bookmark>, String> {
    db.list_bookmarks(&vault_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn bookmarks_add(
    db: State<'_, MobileDb>,
    vault_id: String,
    path: String,
    title: String,
) -> Result<Bookmark, String> {
    db.add_bookmark(&vault_id, &path, &title)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn bookmarks_remove(
    db: State<'_, MobileDb>,
    vault_id: String,
    bookmark_id: String,
) -> Result<(), String> {
    db.remove_bookmark(&vault_id, &bookmark_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn sync_add_remote(
    sync: State<'_, SyncHandle>,
    base_url: String,
    api_key: String,
) -> Result<String, String> {
    sync.add_remote(base_url, api_key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn sync_map_vault(
    sync: State<'_, SyncHandle>,
    remote_id: String,
    local_vault_id: String,
    remote_vault_id: String,
) -> Result<(), String> {
    sync.map_vault(remote_id, local_vault_id, remote_vault_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn sync_list_remotes(sync: State<'_, SyncHandle>) -> Result<Vec<RemoteDto>, String> {
    sync.list_remotes().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn sync_list_remote_vaults(
    sync: State<'_, SyncHandle>,
    remote_id: String,
) -> Result<Vec<Vault>, String> {
    sync.list_remote_vaults(remote_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn sync_create_remote_vault(
    sync: State<'_, SyncHandle>,
    remote_id: String,
    name: String,
) -> Result<Vault, String> {
    sync.create_remote_vault(remote_id, name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn sync_remove_remote(sync: State<'_, SyncHandle>, remote_id: String) -> Result<(), String> {
    sync.remove_remote(remote_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn sync_unmap_vault(
    sync: State<'_, SyncHandle>,
    remote_id: String,
    local_vault_id: String,
) -> Result<(), String> {
    sync.unmap_vault(remote_id, local_vault_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn sync_status(sync: State<'_, SyncHandle>) -> Result<Vec<VaultStatus>, String> {
    Ok(sync.status().await)
}

#[tauri::command]
async fn sync_start(sync: State<'_, SyncHandle>) -> Result<(), String> {
    sync.start().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn sync_stop(sync: State<'_, SyncHandle>) -> Result<(), String> {
    sync.stop().await;
    Ok(())
}

/// Validate and pair with a remote, storing its API key in platform secure
/// storage rather than a config/database file.
#[tauri::command]
async fn pairing_set(
    sync: State<'_, SyncHandle>,
    base_url: String,
    api_key: String,
) -> Result<(), String> {
    sync.pairing_set(base_url, api_key)
        .await
        .map_err(|e| e.to_string())
}

/// The paired remote's base URL and whether a key is stored — never the key
/// itself, which must never cross the IPC boundary to the WebView.
#[tauri::command]
async fn pairing_get(sync: State<'_, SyncHandle>) -> Result<Option<PairingInfo>, String> {
    sync.pairing_get().await.map_err(|e| e.to_string())
}

/// Stop syncing, remove the paired remote, and erase the stored key.
#[tauri::command]
async fn pairing_clear(sync: State<'_, SyncHandle>) -> Result<(), String> {
    sync.pairing_clear().await.map_err(|e| e.to_string())
}

/// The crate's Tauri integration point. Wire it into the app builder with:
///
/// ```ignore
/// tauri::Builder::default()
///     .invoke_handler(librarium_mobile::invoke_handler())
///     // ...
/// ```
pub fn invoke_handler<R: tauri::Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool {
    tauri::generate_handler![
        vault_list,
        vault_get,
        file_tree,
        file_read,
        file_write,
        file_create,
        file_delete,
        file_rename,
        directory_create,
        render_markdown,
        render_markdown_in_vault,
        resolve_wiki_link,
        backlinks,
        outgoing_links,
        tags_list,
        tag_files,
        frontmatter_read,
        frontmatter_write,
        search,
        search_paged,
        search_index_rebuild,
        search_index_size,
        preferences_get,
        preferences_set,
        preferences_reset,
        recent_list,
        recent_record,
        favorites_list,
        favorites_add,
        favorites_remove,
        bookmarks_list,
        bookmarks_add,
        bookmarks_remove,
        sync_add_remote,
        sync_map_vault,
        sync_list_remotes,
        sync_list_remote_vaults,
        sync_create_remote_vault,
        sync_remove_remote,
        sync_unmap_vault,
        sync_status,
        sync_start,
        sync_stop,
        pairing_set,
        pairing_get,
        pairing_clear,
    ]
}
