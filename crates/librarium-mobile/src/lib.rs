//! Local command layer for the Route C thin mobile client — the first four
//! slices of the backend that replaces the embedded server (LIB Route-C-06,
//! Route-C-07, Route-C-08, Route-C-09).
//!
//! Every command is plain Rust over `librarium_core` services (or, for
//! `search`/`metadata`, their own stateful store — see those modules' doc
//! comments for why they alone aren't stateless), so the logic is
//! unit-testable without a Tauri runtime. `commands` layers thin
//! `#[tauri::command]` wrappers on top that resolve paths (and open the
//! metadata store) via Tauri's path API. Only [`invoke_handler`] is public
//! from `commands` — see that module's doc comment for why the commands
//! themselves are not.
//!
//! Out of scope here (later Route C phases): frontend wiring (phase 2).

mod commands;
mod file;
mod frontmatter;
mod links;
mod metadata;
mod render;
mod search;
mod secrets;
mod sync;
mod tags;
mod vault;

pub use commands::invoke_handler;
pub use file::{
    directory_create, file_create, file_delete, file_read, file_rename, file_tree, file_write,
};
pub use file::{DirectoryCreateResult, RenameResult};
pub use frontmatter::{frontmatter_read, frontmatter_write};
pub use links::{backlinks, outgoing_links, resolve_wiki_link};
pub use links::{LinkedNote, ResolveWikiLinkResult};
pub use metadata::{Bookmark, Favorite, MobileDb, SyncPolicy};
pub use render::{render_markdown, render_markdown_in_vault};
pub use search::{
    build_index, index_size_on_disk, rebuild_index, search, search_paged, update_incremental,
};
pub use secrets::{InMemorySecretStore, OsKeyringStore, SecretStore};
pub use sync::{PairingInfo, RemoteDto, SyncHandle};
pub use tags::{tag_files, tags_list, TagEntry};
pub use vault::{vault_get, vault_list};
