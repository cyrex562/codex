use crate::error::{AppError, AppResult};
use crate::services::schema_service::EntityTypeRegistry;

pub struct TemplateService;

impl TemplateService {
    /// Return the template markdown content for an entity type.
    /// The template file path is resolved relative to the plugin directory
    /// (stored in the entity type schema), falling back to a minimal
    /// generated template when the file is absent.
    pub async fn get_template(
        registry: &EntityTypeRegistry,
        entity_type_id: &str,
        plugins_dir: &str,
    ) -> AppResult<String> {
        let schema = registry
            .get_by_id(entity_type_id)
            .await
            .ok_or_else(|| {
                AppError::NotFound(format!("Entity type not found: {entity_type_id}"))
            })?;

        // If the plugin declared a template file, try to read it
        if let Some(ref template_rel) = schema.template {
            // The plugin dir lives at <plugins_dir>/<plugin_id_last_segment>
            // We stored the full plugin directory path in the registry implicitly
            // via SchemaService — but PluginService stores plugin.path.
            // For now we derive the plugin dir from plugins_dir + plugin_id basename.
            let plugin_basename = schema.plugin_id.rsplit('.').next().unwrap_or(&schema.plugin_id);
            let template_abs = format!("{plugins_dir}/{plugin_basename}/{template_rel}");
            if let Ok(content) = tokio::fs::read_to_string(&template_abs).await {
                return Ok(content);
            }
        }

        // Fallback: generate a minimal template from the schema
        Ok(generate_minimal_template(&schema))
    }
}

fn generate_minimal_template(
    schema: &crate::models::schema::EntityTypeSchema,
) -> String {
    use std::fmt::Write;
    let mut fm = String::new();
    writeln!(fm, "---").unwrap();
    writeln!(fm, "codex_type: {}", schema.name).unwrap();
    writeln!(fm, "codex_plugin: {}", schema.plugin_id).unwrap();
    if !schema.labels.is_empty() {
        writeln!(fm, "codex_labels:").unwrap();
        for label in &schema.labels {
            writeln!(fm, "  - {label}").unwrap();
        }
    }
    for field in &schema.fields {
        let default_val = field
            .default
            .as_ref()
            .map(|v| {
                if let Some(s) = v.as_str() {
                    format!(" {s}")
                } else {
                    format!(" {v}")
                }
            })
            .unwrap_or_else(|| " \"\"".to_string());
        writeln!(fm, "{}:{}", field.key, default_val).unwrap();
    }
    writeln!(fm, "---").unwrap();
    writeln!(fm).unwrap();
    writeln!(fm, "<!-- codex:prose:begin -->").unwrap();
    writeln!(fm).unwrap();
    writeln!(fm, "<!-- codex:prose:end -->").unwrap();
    fm
}
