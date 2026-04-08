use crate::db::Database;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use tracing::info;

/// Core reserved labels that ship with Codex. Plugins may not redefine these.
pub const CORE_LABELS: &[(&str, &str)] = &[
    ("graphable", "Entity appears in graph views"),
    ("person", "A human or human-like character"),
    ("organization", "A group, faction, institution, or company"),
    ("place", "A physical or conceptual location"),
    ("event", "A point or span in time"),
    ("object", "A physical artefact or item"),
    ("concept", "An abstract idea, technology, or system"),
    ("creature", "A non-human living entity"),
];

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Label {
    pub name: String,
    pub description: Option<String>,
    pub source: String,
    pub plugin_id: Option<String>,
}

pub struct LabelService;

impl LabelService {
    /// Seed the 8 core reserved labels on startup. Uses INSERT OR IGNORE so
    /// this is safe to call on every startup.
    pub async fn seed_core_labels(db: &Database) -> AppResult<()> {
        for (name, description) in CORE_LABELS {
            sqlx::query(
                r#"
                INSERT OR IGNORE INTO labels (name, description, source, plugin_id)
                VALUES (?, ?, 'core', NULL)
                "#,
            )
            .bind(name)
            .bind(description)
            .execute(db.pool())
            .await
            .map_err(|e| AppError::DatabaseError(crate::error::DatabaseErrorContext {
                error: e,
                operation: "seed_core_labels".into(),
                details: Some(format!("label: {name}")),
            }))?;
        }
        info!("Seeded {} core labels", CORE_LABELS.len());
        Ok(())
    }

    /// Register a plugin-declared label. Returns a `Conflict` error if the
    /// label name is already owned by a *different* plugin (or by core).
    pub async fn register(
        db: &Database,
        name: &str,
        description: Option<&str>,
        plugin_id: &str,
    ) -> AppResult<()> {
        // Check for existing registration
        let existing: Option<Label> =
            sqlx::query_as("SELECT name, description, source, plugin_id FROM labels WHERE name = ?")
                .bind(name)
                .fetch_optional(db.pool())
                .await
                .map_err(|e| AppError::DatabaseError(crate::error::DatabaseErrorContext {
                    error: e,
                    operation: "register_label_check".into(),
                    details: None,
                }))?;

        if let Some(existing) = existing {
            let owner = existing.plugin_id.as_deref().unwrap_or("<core>");
            if owner != plugin_id {
                return Err(AppError::Conflict(format!(
                    "Label '{name}' is already registered by '{owner}'"
                )));
            }
            // Same plugin re-registering — idempotent, nothing to do.
            return Ok(());
        }

        sqlx::query(
            r#"
            INSERT INTO labels (name, description, source, plugin_id)
            VALUES (?, ?, 'plugin', ?)
            "#,
        )
        .bind(name)
        .bind(description)
        .bind(plugin_id)
        .execute(db.pool())
        .await
        .map_err(|e| AppError::DatabaseError(crate::error::DatabaseErrorContext {
            error: e,
            operation: "register_label".into(),
            details: Some(format!("label: {name}")),
        }))?;

        Ok(())
    }

    /// Remove all labels registered by the given plugin.
    pub async fn remove_plugin_labels(db: &Database, plugin_id: &str) -> AppResult<()> {
        sqlx::query("DELETE FROM labels WHERE plugin_id = ?")
            .bind(plugin_id)
            .execute(db.pool())
            .await
            .map_err(|e| AppError::DatabaseError(crate::error::DatabaseErrorContext {
                error: e,
                operation: "remove_plugin_labels".into(),
                details: None,
            }))?;
        Ok(())
    }

    /// List all registered labels (core + plugin).
    pub async fn list(db: &Database) -> AppResult<Vec<Label>> {
        let labels: Vec<Label> =
            sqlx::query_as("SELECT name, description, source, plugin_id FROM labels ORDER BY source, name")
                .fetch_all(db.pool())
                .await
                .map_err(|e| AppError::DatabaseError(crate::error::DatabaseErrorContext {
                    error: e,
                    operation: "list_labels".into(),
                    details: None,
                }))?;
        Ok(labels)
    }
}
