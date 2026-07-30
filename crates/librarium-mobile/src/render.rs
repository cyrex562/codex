//! Markdown rendering, backed directly by `librarium_core::markdown_service`
//! — the exact same `pulldown-cmark`-based renderer the server uses via
//! `MarkdownParser` (`librarium_types::DocumentParser`). Rendered HTML is
//! sanitized client-side by DOMPurify already (per the issue); this crate
//! must not add a second sanitizer with different rules.
//!
//! `spawn_blocking`-wrapped like every other command here, even though a
//! single render is normally fast: worst case (a huge note, syntax
//! highlighting on many code blocks) shouldn't be able to stall the IPC
//! executor.

use librarium_core::markdown_service::MarkdownParser;
use librarium_types::DocumentParser;

/// Mirrors `POST /api/render`: no vault context, no wiki-link resolution.
pub async fn render_markdown(content: &str) -> String {
    let content = content.to_string();
    tokio::task::spawn_blocking(move || MarkdownParser.render(&content).html)
        .await
        .unwrap_or_default()
}

/// Mirrors `POST /api/vaults/{id}/render`: resolves wiki links and embeds
/// against `vault_path`, optionally relative to `current_file`.
pub async fn render_markdown_in_vault(
    vault_path: &str,
    content: &str,
    current_file: Option<&str>,
) -> String {
    let vault_path = vault_path.to_string();
    let content = content.to_string();
    let current_file = current_file.map(str::to_string);
    tokio::task::spawn_blocking(move || {
        MarkdownParser
            .render_with_context(&content, Some(&vault_path), current_file.as_deref())
            .html
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn render_markdown_produces_html() {
        let html = render_markdown("# Hello\n\n**bold**").await;
        assert!(html.contains("<h1>Hello</h1>"));
        assert!(html.contains("<strong>bold</strong>"));
    }

    #[tokio::test]
    async fn render_markdown_in_vault_resolves_wiki_links() {
        let vault = tempfile::TempDir::new().unwrap();
        std::fs::write(vault.path().join("Target.md"), "# Target").unwrap();

        let html =
            render_markdown_in_vault(vault.path().to_str().unwrap(), "See [[Target]]", None).await;
        assert!(html.contains("wiki-link"));
        assert!(!html.contains("broken-link"), "html: {html}");
    }

    #[tokio::test]
    async fn render_markdown_in_vault_marks_unresolved_links_broken() {
        let vault = tempfile::TempDir::new().unwrap();
        let html =
            render_markdown_in_vault(vault.path().to_str().unwrap(), "See [[Nope]]", None).await;
        assert!(html.contains("broken-link"));
    }
}
