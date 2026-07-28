//! End-to-end coverage of the desktop→server sync wire contract over real HTTP:
//! the `X-API-Key` auth path, the `?since_seq=` changes cursor + `ChangesPage`
//! envelope, per-file content hashes, the manifest endpoint, and a binary
//! upload/download round-trip — all driven through the actual `ObsidianClient`
//! the sync engine uses.

use actix_web::{web, App};
use argon2::password_hash::{rand_core::OsRng, PasswordHasher, SaltString};
use argon2::Argon2;
use librarium::config::AppConfig;
use librarium::db::Database;
use librarium::middleware::AuthMiddleware;
use librarium::models::CreateFileRequest;
use librarium::routes::{files, vaults, AppState};
use librarium::services::{MarkdownParser, SearchIndex};
use librarium::watcher::FileWatcher;
use librarium_client::ObsidianClient;
use std::sync::Arc;
use tempfile::TempDir;
use tokio::sync::{broadcast, Mutex};

fn build_state(db: Database) -> web::Data<AppState> {
    let search_index = SearchIndex::new();
    let (watcher, _) = FileWatcher::new().unwrap();
    let watcher = Arc::new(Mutex::new(watcher));
    let (event_tx, _) = broadcast::channel(100);

    web::Data::new(AppState {
        db,
        search_index,
        watcher,
        event_broadcaster: event_tx,
        ws_broadcaster: broadcast::channel::<librarium::models::WsMessage>(16).0,
        change_log_retention_days: 7,
        ml_undo_store: Arc::new(Mutex::new(std::collections::HashMap::new())),
        shutdown_tx: broadcast::channel::<()>(1).0,
        document_parser: Arc::new(MarkdownParser),
        entity_type_registry: librarium::services::EntityTypeRegistry::new(),
        relation_type_registry: librarium::services::RelationTypeRegistry::new(),
        plugins_dir: std::path::PathBuf::new(),
    })
}

/// Insert an API key for `user_id` the same way the server route does and return
/// the raw `obh_` key to hand to the client.
async fn make_api_key(db: &Database, user_id: &str) -> String {
    let raw = "obh_0123456789abcdef0123456789abcdef".to_string();
    let prefix: String = raw.strip_prefix("obh_").unwrap().chars().take(12).collect();
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(raw.as_bytes(), &salt)
        .unwrap()
        .to_string();
    db.create_api_key("key-1", "test", &prefix, &hash, user_id, None)
        .await
        .unwrap();
    raw
}

#[actix_web::test]
async fn sync_endpoints_round_trip_over_http_with_api_key() {
    let tmp = TempDir::new().unwrap();
    let db_url = format!("sqlite://{}", tmp.path().join("e2e.db").display());
    let db = Database::new(&db_url).await.unwrap();

    db.bootstrap_admin_if_empty(Some("admin"), Some("hunter2"))
        .await
        .unwrap();
    let (admin_id, _) = db.get_user_by_username("admin").await.unwrap().unwrap();

    // Vault owned by the admin so the API-key user is authorized on it.
    let vault_dir = tmp.path().join("vault");
    std::fs::create_dir_all(&vault_dir).unwrap();
    let vault = db
        .create_vault_for_owner(
            "V".to_string(),
            vault_dir.to_string_lossy().to_string(),
            Some(&admin_id),
        )
        .await
        .unwrap();
    let vault_id = vault.id.clone();

    let api_key = make_api_key(&db, &admin_id).await;

    let state = build_state(db.clone());
    let mut config = AppConfig::default();
    config.auth.enabled = true;
    config.auth.jwt_secret = "e2e-secret".to_string();
    let config = web::Data::new(config);

    let srv = actix_test::start(move || {
        App::new()
            .app_data(state.clone())
            .app_data(config.clone())
            .wrap(AuthMiddleware)
            .configure(vaults::configure)
            .configure(files::configure)
    });

    let base = srv.url("");
    let client = ObsidianClient::for_cloud(base).with_api_key(api_key);

    // 1. Create a markdown file via the API-key-authenticated client.
    client
        .create_file(
            &vault_id,
            &CreateFileRequest {
                path: "note.md".to_string(),
                content: Some("hello world".to_string()),
            },
        )
        .await
        .expect("create_file should succeed with a valid API key");

    // 2. The seq-based changes cursor returns the create with a content hash.
    let page = client.get_changes_since_seq(&vault_id, 0).await.unwrap();
    assert_eq!(page.head_seq, 1, "one change recorded");
    let created = page
        .events
        .iter()
        .find(|e| e.path == "note.md")
        .expect("note.md change present");
    assert_eq!(created.seq, 1);
    let logged_hash = created
        .content_hash
        .clone()
        .expect("content hash present on create");

    // 3. The manifest reports the same on-disk hash for the file.
    let manifest = client.get_manifest(&vault_id).await.unwrap();
    let note = manifest
        .iter()
        .find(|e| e.path == "note.md")
        .expect("note.md in manifest");
    assert_eq!(
        note.content_hash, logged_hash,
        "manifest and change-log hashes must agree (same on-disk bytes)"
    );

    // 4. Raw byte download matches what is on disk.
    let bytes = client
        .download_file_bytes(&vault_id, "note.md")
        .await
        .unwrap();
    let on_disk = std::fs::read(vault_dir.join("note.md")).unwrap();
    assert_eq!(bytes, on_disk);

    // 5. A cursor at the head returns no events but still reports the head.
    let empty = client
        .get_changes_since_seq(&vault_id, page.head_seq)
        .await
        .unwrap();
    assert!(empty.events.is_empty());
    assert_eq!(empty.head_seq, page.head_seq);

    // 6. Binary upload/download round-trips through the raw-bytes path.
    let blob: Vec<u8> = vec![0, 1, 2, 3, 250, 200, 100, 255];
    client
        .upload_file_bytes(&vault_id, "assets/data.bin", blob.clone())
        .await
        .expect("binary upload should succeed");
    let back = client
        .download_file_bytes(&vault_id, "assets/data.bin")
        .await
        .unwrap();
    assert_eq!(back, blob, "binary round-trip must be byte-exact");

    let manifest2 = client.get_manifest(&vault_id).await.unwrap();
    assert!(
        manifest2.iter().any(|e| e.path == "assets/data.bin"),
        "uploaded binary appears in the manifest"
    );

    // 7. Auth is actually enforced: a bad key is rejected.
    let bad = ObsidianClient::for_cloud(srv.url("")).with_api_key("obh_bogusbogusbogus");
    assert!(
        bad.get_manifest(&vault_id).await.is_err(),
        "an invalid API key must be rejected"
    );
}
