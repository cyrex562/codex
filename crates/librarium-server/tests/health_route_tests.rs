//! `/api/health` exposes `auth_enabled` so the frontend can detect a
//! server running with auth disabled and bypass the login screen instead of
//! deadlocking on it (no admin is ever bootstrapped when auth is disabled —
//! see `lib.rs::run`'s bootstrap branch).

use actix_web::{test, web};
use librarium::config::AppConfig;
use librarium::db::Database;
use librarium::routes::{health, AppState};
use librarium::services::{EntityTypeRegistry, MarkdownParser, RelationTypeRegistry, SearchIndex};
use librarium::watcher::FileWatcher;
use std::sync::Arc;
use tempfile::TempDir;
use tokio::sync::{broadcast, Mutex};

mod common;
use common::test_app_with_config;

async fn setup(temp_dir: &TempDir) -> web::Data<AppState> {
    let db_path = temp_dir.path().join("health-test.db");
    let db_url = format!("sqlite://{}", db_path.display());
    let db = Database::new(&db_url).await.unwrap();

    let search_index = SearchIndex::new();
    let (watcher, _) = FileWatcher::new().unwrap();
    let watcher = Arc::new(Mutex::new(watcher));
    let (event_tx, _) = broadcast::channel(100);

    web::Data::new(AppState {
        db,
        search_index,
        watcher,
        event_broadcaster: event_tx,
        ws_broadcaster: tokio::sync::broadcast::channel::<librarium::models::WsMessage>(16).0,
        change_log_retention_days: 7,
        ml_undo_store: Arc::new(Mutex::new(std::collections::HashMap::new())),
        shutdown_tx: broadcast::channel::<()>(1).0,
        document_parser: Arc::new(MarkdownParser),
        entity_type_registry: EntityTypeRegistry::new(),
        relation_type_registry: RelationTypeRegistry::new(),
        plugins_dir: std::path::PathBuf::new(),
    })
}

#[actix_web::test]
async fn health_reports_auth_enabled_true() {
    let temp = TempDir::new().unwrap();
    let state = setup(&temp).await;
    let mut config = AppConfig::default();
    config.auth.enabled = true;

    let app = test::init_service(test_app_with_config(state, config, health::configure)).await;

    let req = test::TestRequest::get().uri("/api/health").to_request();
    let resp = test::call_service(&app, req).await;
    assert!(resp.status().is_success());

    let body: serde_json::Value = test::read_body_json(resp).await;
    assert_eq!(body["status"], "healthy");
    assert_eq!(body["auth_enabled"], true);
}

#[actix_web::test]
async fn health_reports_auth_enabled_false() {
    let temp = TempDir::new().unwrap();
    let state = setup(&temp).await;
    let mut config = AppConfig::default();
    config.auth.enabled = false;

    let app = test::init_service(test_app_with_config(state, config, health::configure)).await;

    let req = test::TestRequest::get().uri("/api/health").to_request();
    let resp = test::call_service(&app, req).await;
    assert!(resp.status().is_success());

    let body: serde_json::Value = test::read_body_json(resp).await;
    assert_eq!(body["auth_enabled"], false);
}
