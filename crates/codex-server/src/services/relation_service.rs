use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::services::entity_service::{Entity, EntityService};
use crate::services::schema_service::RelationTypeRegistry;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tracing::{debug, warn};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Relation {
    pub id: String,
    pub vault_id: String,
    pub from_entity_id: String,
    pub to_entity_id: String,
    pub relation_type: String,
    pub direction: String,
    pub metadata: Option<String>,
    pub source: String,
    pub source_field: Option<String>,
    pub created_at: String,
}

pub struct RelationService;

impl RelationService {
    /// Derive relation edges from an entity's `entity_ref` fields.
    ///
    /// When `registry` is provided, the inverse label is looked up from the
    /// registered relation type schema. Otherwise falls back to the Phase 1
    /// generic `"inverse_of_<field>"` name.
    pub async fn sync_from_entity(
        db: &Database,
        entity: &Entity,
        registry: Option<&RelationTypeRegistry>,
    ) -> AppResult<()> {
        // Remove all existing field-derived relations for this entity so we
        // start fresh (avoids stale edges after a field value changes).
        sqlx::query(
            "DELETE FROM relations WHERE from_entity_id = ? AND source = 'field'",
        )
        .bind(&entity.id)
        .execute(db.pool())
        .await
        .map_err(|e| AppError::DatabaseError(crate::error::DatabaseErrorContext {
            error: e,
            operation: "clear_field_relations".into(),
            details: None,
        }))?;

        let fields = entity.fields_map();
        let obj = match fields.as_object() {
            Some(o) => o,
            None => return Ok(()),
        };

        for (field_key, field_value) in obj {
            // Handle both scalar and list entity refs
            let ref_values: Vec<&str> = match field_value {
                serde_json::Value::String(s) => vec![s.as_str()],
                serde_json::Value::Array(arr) => arr
                    .iter()
                    .filter_map(|v| v.as_str())
                    .collect(),
                _ => continue,
            };

            for ref_val in ref_values {
                let title = extract_wiki_title(ref_val);
                if title.is_none() {
                    continue;
                }
                let title = title.unwrap();

                // Try to resolve by basename match
                let target = Self::resolve_target(db, &entity.vault_id, title).await;
                match target {
                    Ok(Some(target_entity)) => {
                        // Determine the inverse label using registry if available
                        let inverse_type = if let Some(reg) = registry {
                            reg.find_by_name(field_key).await
                                .and_then(|rt| rt.inverse_label)
                                .unwrap_or_else(|| format!("inverse_of_{field_key}"))
                        } else {
                            format!("inverse_of_{field_key}")
                        };

                        // Create forward edge
                        Self::insert_relation(
                            db,
                            &entity.vault_id,
                            &entity.id,
                            &target_entity.id,
                            field_key,
                            "forward",
                            field_key,
                        )
                        .await?;

                        // Create inverse edge
                        Self::insert_relation(
                            db,
                            &entity.vault_id,
                            &target_entity.id,
                            &entity.id,
                            &inverse_type,
                            "inverse",
                            field_key,
                        )
                        .await?;

                        debug!(
                            "Created relation {} → {} ({})",
                            entity.id, target_entity.id, field_key
                        );
                    }
                    Ok(None) => {
                        debug!(
                            "Unresolved entity_ref in {}: [[{title}]] — skipping",
                            entity.path
                        );
                    }
                    Err(e) => {
                        warn!("Error resolving entity_ref [[{title}]]: {e}");
                    }
                }
            }
        }

        Ok(())
    }

    /// Resolve a `[[Title]]` or `[[Title|Alias]]` reference to an entity by
    /// matching the path's file stem (case-insensitive) within the vault.
    ///
    /// Returns `None` gracefully if the target is not yet indexed.
    pub async fn resolve_target(
        db: &Database,
        vault_id: &str,
        title: &str,
    ) -> AppResult<Option<Entity>> {
        // Try exact stem match first, then case-insensitive
        let all = EntityService::list_all_in_vault(db, vault_id).await?;
        let title_lower = title.to_lowercase();
        let found = all.into_iter().find(|e| {
            let stem = std::path::Path::new(&e.path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            stem.to_lowercase() == title_lower
        });
        Ok(found)
    }

    async fn insert_relation(
        db: &Database,
        vault_id: &str,
        from_id: &str,
        to_id: &str,
        relation_type: &str,
        direction: &str,
        source_field: &str,
    ) -> AppResult<()> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            r#"
            INSERT OR IGNORE INTO relations
            (id, vault_id, from_entity_id, to_entity_id, relation_type, direction, metadata, source, source_field, created_at)
            VALUES (?, ?, ?, ?, ?, ?, NULL, 'field', ?, ?)
            "#,
        )
        .bind(id)
        .bind(vault_id)
        .bind(from_id)
        .bind(to_id)
        .bind(relation_type)
        .bind(direction)
        .bind(source_field)
        .bind(now)
        .execute(db.pool())
        .await
        .map_err(|e| AppError::DatabaseError(crate::error::DatabaseErrorContext {
            error: e,
            operation: "insert_relation".into(),
            details: None,
        }))?;
        Ok(())
    }

    /// Get all relations connected to an entity (both directions).
    pub async fn get_for_entity(db: &Database, entity_id: &str) -> AppResult<Vec<Relation>> {
        let relations: Vec<Relation> = sqlx::query_as(
            r#"
            SELECT id, vault_id, from_entity_id, to_entity_id, relation_type, direction,
                   metadata, source, source_field, created_at
            FROM relations
            WHERE from_entity_id = ? OR to_entity_id = ?
            "#,
        )
        .bind(entity_id)
        .bind(entity_id)
        .fetch_all(db.pool())
        .await
        .map_err(|e| AppError::DatabaseError(crate::error::DatabaseErrorContext {
            error: e,
            operation: "get_relations_for_entity".into(),
            details: None,
        }))?;
        Ok(relations)
    }

    /// Get all relations in a vault.
    pub async fn list_for_vault(db: &Database, vault_id: &str) -> AppResult<Vec<Relation>> {
        let relations: Vec<Relation> = sqlx::query_as(
            r#"
            SELECT id, vault_id, from_entity_id, to_entity_id, relation_type, direction,
                   metadata, source, source_field, created_at
            FROM relations WHERE vault_id = ?
            "#,
        )
        .bind(vault_id)
        .fetch_all(db.pool())
        .await
        .map_err(|e| AppError::DatabaseError(crate::error::DatabaseErrorContext {
            error: e,
            operation: "list_vault_relations".into(),
            details: None,
        }))?;
        Ok(relations)
    }

    /// Update relation metadata (used by structural editor sub-form).
    pub async fn update_metadata(
        db: &Database,
        relation_id: &str,
        metadata: &serde_json::Value,
    ) -> AppResult<()> {
        let metadata_json = serde_json::to_string(metadata).map_err(|e| {
            AppError::InternalError(format!("Failed to serialize relation metadata: {e}"))
        })?;
        sqlx::query("UPDATE relations SET metadata = ? WHERE id = ?")
            .bind(metadata_json)
            .bind(relation_id)
            .execute(db.pool())
            .await
            .map_err(|e| AppError::DatabaseError(crate::error::DatabaseErrorContext {
                error: e,
                operation: "update_relation_metadata".into(),
                details: None,
            }))?;
        Ok(())
    }
}

/// Extract the title from a wiki-link string like `[[Title]]` or `[[Title|Alias]]`.
/// Returns `None` if the string is not a wiki-link.
fn extract_wiki_title(s: &str) -> Option<&str> {
    let s = s.trim();
    if !s.starts_with("[[") || !s.ends_with("]]") {
        return None;
    }
    let inner = &s[2..s.len() - 2];
    // Strip alias: [[Title|Alias]] → "Title"
    Some(inner.split('|').next().unwrap_or(inner).trim())
}
