//! Local command layer for the Route C thin mobile client — the first slice
//! of the backend that replaces the embedded server (LIB Route-C-06).
//!
//! Every command is plain Rust over `librarium_core::FileService`, so the
//! logic is unit-testable without a Tauri runtime: `vault`/`file` expose
//! `pub async fn`s taking plain paths, and `commands` layers thin
//! `#[tauri::command]` wrappers on top that resolve those paths via Tauri's
//! path API. Only [`invoke_handler`] is public from `commands` — see that
//! module's doc comment for why the commands themselves are not.
//!
//! Out of scope here (later Route C phases): render/search/metadata commands
//! (#50, #51, #52), sync (#53), frontend wiring (phase 2).

mod commands;
mod file;
mod vault;

pub use commands::invoke_handler;
pub use file::{
    directory_create, file_create, file_delete, file_read, file_rename, file_tree, file_write,
};
pub use file::{DirectoryCreateResult, RenameResult};
pub use vault::{vault_get, vault_list};
