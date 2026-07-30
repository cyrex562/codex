//! End-to-end coverage of the mobile sync bridge (`librarium_mobile::sync`)
//! against a real, in-process `librarium-server` acting as the remote.
//!
//! Covers the acceptance criteria for issue #53 ("Wire librarium-sync with no
//! embedded server"): map a vault, push a local edit, pull a remote edit,
//! observe convergence; conflict handling producing `conflict_*` siblings;
//! and offline outbox draining. Also covers issue #54 ("Secure API-key
//! storage and remote pairing config"): `pairing_set` validates against the
//! real remote before persisting anything, and the API key never appears in
//! `sync.db` (only in the injected `SecretStore`).
//!
//! Modeled directly on
//! `crates/librarium-server/tests/sync_client_e2e.rs` (the existing
//! desktop-sync wire-contract test), extended with a real WebSocket route and
//! driven through `librarium_mobile::SyncHandle` instead of a raw
//! `ObsidianClient`. No changes were made to `crates/librarium-sync` for #53;
//! for #54, `SyncEngine` gained an `ApiKeyProvider` so it never has to
//! persist the raw key itself (see that crate's doc comment for the
//! rationale).

use actix_web::{web, App};
use argon2::password_hash::{rand_core::OsRng, PasswordHasher, SaltString};
use argon2::Argon2;
use librarium::config::AppConfig;
use librarium::db::Database;
use librarium::middleware::AuthMiddleware;
use librarium::routes::{files, vaults, ws, AppState};
use librarium::services::{MarkdownParser, SearchIndex};
use librarium::watcher::FileWatcher;
use librarium_mobile::{InMemorySecretStore, SecretStore, SyncHandle};
use std::future::Future;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
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

/// Insert an API key for `user_id` the same way the server route does and
/// return the raw `obh_` key to hand to the sync engine.
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

/// A running remote (real HTTP + WS server, backed by a real vault directory
/// on disk) plus the pieces needed to drive it.
struct Remote {
    base_url: String,
    api_key: String,
    vault_id: String,
    vault_dir: std::path::PathBuf,
    // Keeps the temp db + vault dirs alive for the test's duration.
    _tmp: TempDir,
}

async fn start_remote() -> Remote {
    let tmp = TempDir::new().unwrap();
    let db_url = format!("sqlite://{}", tmp.path().join("e2e.db").display());
    let db = Database::new(&db_url).await.unwrap();

    db.bootstrap_admin_if_empty(Some("admin"), Some("hunter2"))
        .await
        .unwrap();
    let (admin_id, _) = db.get_user_by_username("admin").await.unwrap().unwrap();

    let vault_dir = tmp.path().join("vault");
    std::fs::create_dir_all(&vault_dir).unwrap();
    let vault = db
        .create_vault_for_owner(
            "Remote Vault".to_string(),
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
            .configure(ws::configure)
    });

    let base_url = srv.url("");
    // Each test starts its own remote and the process exits right after, so
    // leaking the server (rather than threading a shutdown through every
    // test) is the simplest way to keep it alive for the test's duration.
    std::mem::forget(srv);

    Remote {
        base_url,
        api_key,
        vault_id,
        vault_dir,
        _tmp: tmp,
    }
}

/// Write a mobile-side `vaults.json` registry with a single entry, matching
/// the on-disk shape `librarium_mobile::vault` reads (see that module).
fn write_vault_registry(config_dir: &Path, vault_id: &str, vault_path: &Path) {
    let now = chrono::Utc::now().to_rfc3339();
    let registry = serde_json::json!({
        "vaults": [{
            "id": vault_id,
            "name": "Local Vault",
            "path": vault_path.to_string_lossy(),
            "created_at": now,
            "updated_at": now,
            "document_format": "markdown",
        }]
    });
    std::fs::write(
        config_dir.join("vaults.json"),
        serde_json::to_vec_pretty(&registry).unwrap(),
    )
    .unwrap();
}

/// Poll an async condition until it returns `Some`, or panic after `timeout`.
async fn wait_until<T, F, Fut>(timeout: Duration, mut f: F) -> T
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Option<T>>,
{
    let start = std::time::Instant::now();
    loop {
        if let Some(v) = f().await {
            return v;
        }
        if start.elapsed() > timeout {
            panic!("condition not met within {timeout:?}");
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

#[actix_web::test]
async fn maps_a_vault_and_converges_push_and_pull() {
    let remote = start_remote().await;

    let config_dir = TempDir::new().unwrap();
    let sync_dir = TempDir::new().unwrap();
    let local_vault_dir = TempDir::new().unwrap();
    let local_vault_id = "local-v1";
    write_vault_registry(config_dir.path(), local_vault_id, local_vault_dir.path());

    // A pre-existing local file that should get pushed to the remote...
    std::fs::write(local_vault_dir.path().join("note.md"), "local hello").unwrap();
    // ...and a pre-existing remote file that should get pulled locally.
    std::fs::write(remote.vault_dir.join("remote.md"), "remote hello").unwrap();

    let sync = SyncHandle::new(
        sync_dir.path().join("sync.db"),
        config_dir.path().to_path_buf(),
        Arc::new(InMemorySecretStore::default()),
    );
    let remote_id = sync
        .add_remote(remote.base_url.clone(), remote.api_key.clone())
        .await
        .unwrap();
    sync.map_vault(
        remote_id.clone(),
        local_vault_id.to_string(),
        remote.vault_id.clone(),
    )
    .await
    .unwrap();

    wait_until(Duration::from_secs(10), || async {
        let content = std::fs::read_to_string(local_vault_dir.path().join("remote.md")).ok()?;
        (content == "remote hello").then_some(())
    })
    .await;

    wait_until(Duration::from_secs(10), || async {
        let content = std::fs::read_to_string(remote.vault_dir.join("note.md")).ok()?;
        (content == "local hello").then_some(())
    })
    .await;

    sync.stop().await;
}

#[actix_web::test]
async fn divergent_edits_produce_a_conflict_sibling_and_converge_on_the_remote_copy() {
    let remote = start_remote().await;

    let config_dir = TempDir::new().unwrap();
    let sync_dir = TempDir::new().unwrap();
    let local_vault_dir = TempDir::new().unwrap();
    let local_vault_id = "local-v1";
    write_vault_registry(config_dir.path(), local_vault_id, local_vault_dir.path());

    // Never-before-synced file, diverging on both sides from the first sync:
    // a genuine three-way conflict (base = None, local and remote both
    // present and different).
    std::fs::write(local_vault_dir.path().join("shared.md"), "local change").unwrap();
    std::fs::write(remote.vault_dir.join("shared.md"), "remote change").unwrap();

    let sync = SyncHandle::new(
        sync_dir.path().join("sync.db"),
        config_dir.path().to_path_buf(),
        Arc::new(InMemorySecretStore::default()),
    );
    let remote_id = sync
        .add_remote(remote.base_url.clone(), remote.api_key.clone())
        .await
        .unwrap();
    sync.map_vault(
        remote_id.clone(),
        local_vault_id.to_string(),
        remote.vault_id.clone(),
    )
    .await
    .unwrap();

    // The remote copy wins the canonical path (server is the hub)...
    wait_until(Duration::from_secs(10), || async {
        let content = std::fs::read_to_string(local_vault_dir.path().join("shared.md")).ok()?;
        (content == "remote change").then_some(())
    })
    .await;

    // ...and the local edit is preserved as a `conflict_*` sibling rather than
    // silently dropped, and propagated to the remote too.
    wait_until(Duration::from_secs(10), || async {
        let sibling = std::fs::read_dir(local_vault_dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .find(|e| {
                let name = e.file_name();
                let name = name.to_string_lossy();
                name.starts_with("conflict_shared_") && name.ends_with(".md")
            })?;
        let content = std::fs::read_to_string(sibling.path()).ok()?;
        (content == "local change").then_some(())
    })
    .await;

    sync.stop().await;
}

#[actix_web::test]
async fn a_queued_outbox_entry_drains_on_the_next_sync_cycle() {
    let remote = start_remote().await;

    let config_dir = TempDir::new().unwrap();
    let sync_dir = TempDir::new().unwrap();
    let sync_db_path = sync_dir.path().join("sync.db");
    let local_vault_dir = TempDir::new().unwrap();
    let local_vault_id = "local-v1";
    write_vault_registry(config_dir.path(), local_vault_id, local_vault_dir.path());

    let sync = SyncHandle::new(
        sync_db_path.clone(),
        config_dir.path().to_path_buf(),
        Arc::new(InMemorySecretStore::default()),
    );
    let remote_id = sync
        .add_remote(remote.base_url.clone(), remote.api_key.clone())
        .await
        .unwrap();
    sync.map_vault(
        remote_id.clone(),
        local_vault_id.to_string(),
        remote.vault_id.clone(),
    )
    .await
    .unwrap();
    sync.stop().await;

    // Simulate an edit that was captured while offline and durably queued —
    // e.g. by a watcher task that ran before a later crash/restart — by
    // seeding the sync-state database's outbox table directly: the same
    // durable store the engine itself drains from on the next cycle.
    std::fs::write(local_vault_dir.path().join("queued.md"), "queued content").unwrap();
    let store = librarium_sync::SyncStore::open(&sync_db_path)
        .await
        .unwrap();
    store
        .enqueue_outbox(
            &remote_id,
            local_vault_id,
            "queued.md",
            librarium_sync::OutboxOp::Upsert,
            None,
            None,
            0,
        )
        .await
        .unwrap();
    let queued_before = store.list_outbox(&remote_id, local_vault_id).await.unwrap();
    assert_eq!(queued_before.len(), 1, "outbox entry was seeded");

    sync.start().await.unwrap();

    // The queued push reaches the remote...
    wait_until(Duration::from_secs(10), || async {
        let content = std::fs::read_to_string(remote.vault_dir.join("queued.md")).ok()?;
        (content == "queued content").then_some(())
    })
    .await;

    // ...and the seeded outbox entry is drained (deleted) once processed.
    wait_until(Duration::from_secs(10), || async {
        let remaining = store.list_outbox(&remote_id, local_vault_id).await.unwrap();
        remaining.is_empty().then_some(())
    })
    .await;

    sync.stop().await;
}

#[actix_web::test]
async fn pairing_set_validates_persists_and_clears_without_leaking_the_key_into_sync_db() {
    let remote = start_remote().await;

    let config_dir = TempDir::new().unwrap();
    let sync_dir = TempDir::new().unwrap();
    let sync_db_path = sync_dir.path().join("sync.db");
    let secrets = Arc::new(InMemorySecretStore::default());
    let sync = SyncHandle::new(
        sync_db_path.clone(),
        config_dir.path().to_path_buf(),
        secrets.clone(),
    );

    // A wrong key is rejected before anything is persisted.
    let err = sync
        .pairing_set(
            remote.base_url.clone(),
            "obh_wrongwrongwrongwrongwrongwrong".to_string(),
        )
        .await
        .unwrap_err();
    assert!(err.to_string().contains("could not validate"));
    assert!(sync.pairing_get().await.unwrap().is_none());

    // The real key pairs successfully.
    sync.pairing_set(remote.base_url.clone(), remote.api_key.clone())
        .await
        .unwrap();

    let info = sync.pairing_get().await.unwrap().expect("pairing recorded");
    assert_eq!(info.base_url, remote.base_url);
    assert!(info.key_present);

    // The key never touches sync.db, even after a real, successful pairing.
    let raw = std::fs::read(&sync_db_path).unwrap();
    assert!(
        !raw.windows(remote.api_key.len())
            .any(|w| w == remote.api_key.as_bytes()),
        "the raw API key must never appear in sync.db"
    );

    sync.pairing_clear().await.unwrap();
    assert!(sync.pairing_get().await.unwrap().is_none());
    assert!(secrets.get("primary").unwrap().is_none());
}
