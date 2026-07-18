use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// A user's favorite note within a specific vault. Distinct from `Bookmark`,
/// which is per-vault and shared across users; `Favorite` is scoped to a
/// single user so different accounts can maintain independent starred lists.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Favorite {
    pub user_id: String,
    pub vault_id: String,
    pub path: String,
    pub created_at: String,
}
