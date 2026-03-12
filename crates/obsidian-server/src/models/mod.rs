use chrono::{DateTime, Utc};
use sqlx::FromRow;

pub mod graph;
pub mod plugin;

pub use obsidian_types::{
    CreateFileRequest, CreateUploadSessionRequest, CreateVaultRequest, EditorMode, FileChangeEvent,
    FileChangeType, FileContent, FileNode, PagedSearchResult, SearchMatch, SearchResult,
    UpdateFileRequest, UploadSessionResponse, UserPreferences, Vault, WsMessage,
};

#[derive(Debug, Clone, FromRow)]
pub(crate) struct VaultRow {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: String,
    pub updated_at: String,
}

impl From<VaultRow> for Vault {
    fn from(row: VaultRow) -> Self {
        let path_exists = std::path::Path::new(&row.path).exists();
        Self {
            id: row.id,
            name: row.name,
            path: row.path,
            path_exists,
            created_at: DateTime::parse_from_rfc3339(&row.created_at)
                .ok()
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(Utc::now),
            updated_at: DateTime::parse_from_rfc3339(&row.updated_at)
                .ok()
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(Utc::now),
        }
    }
}
