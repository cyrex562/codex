//! Unit coverage for the sync-hardening additions to the change log:
//! per-vault monotonic `seq`, content hashes, the API-vs-watcher de-dup guard,
//! the seq-based reader, the manifest builder, and migration idempotency.

use librarium::db::Database;
use librarium::services::FileService;
use tempfile::TempDir;

async fn open_db(tmp: &TempDir) -> Database {
    let db_url = format!("sqlite://{}", tmp.path().join("change-log.db").display());
    Database::new(&db_url).await.unwrap()
}

async fn make_vault(db: &Database, tmp: &TempDir) -> String {
    let vault_dir = tmp.path().join("vault");
    std::fs::create_dir_all(&vault_dir).unwrap();
    let vault = db
        .create_vault("V".to_string(), vault_dir.to_string_lossy().to_string())
        .await
        .unwrap();
    vault.id
}

#[tokio::test]
async fn seq_is_dense_and_dedup_guard_skips_redundant_writes() {
    let tmp = TempDir::new().unwrap();
    let db = open_db(&tmp).await;
    let vid = make_vault(&db, &tmp).await;

    // First create claims seq 1 and records the hash.
    let s1 = db
        .log_file_change(&vid, "a.md", "created", Some("hashA"), None, None, 0)
        .await
        .unwrap();
    assert_eq!(s1, Some(1));

    // Same content again (e.g. the watcher re-observing an API write) is a
    // no-op: no new row, no seq consumed.
    let s2 = db
        .log_file_change(&vid, "a.md", "modified", Some("hashA"), None, None, 0)
        .await
        .unwrap();
    assert_eq!(s2, None);

    // Genuinely new content advances the seq.
    let s3 = db
        .log_file_change(&vid, "a.md", "modified", Some("hashB"), None, None, 0)
        .await
        .unwrap();
    assert_eq!(s3, Some(2));

    // A delete always logs...
    let s4 = db
        .log_file_change(&vid, "a.md", "deleted", None, None, None, 0)
        .await
        .unwrap();
    assert_eq!(s4, Some(3));

    // ...but a second consecutive delete is redundant and skipped.
    let s5 = db
        .log_file_change(&vid, "a.md", "deleted", None, None, None, 0)
        .await
        .unwrap();
    assert_eq!(s5, None);
}

#[tokio::test]
async fn seq_reader_orders_by_seq_and_returns_hash_and_head() {
    let tmp = TempDir::new().unwrap();
    let db = open_db(&tmp).await;
    let vid = make_vault(&db, &tmp).await;

    db.log_file_change(&vid, "a.md", "created", Some("h1"), None, None, 0)
        .await
        .unwrap();
    db.log_file_change(&vid, "b.md", "created", Some("h2"), None, None, 0)
        .await
        .unwrap();
    db.log_file_change(&vid, "a.md", "modified", Some("h3"), None, None, 0)
        .await
        .unwrap();

    let page = db.get_file_changes_since_seq(&vid, 0).await.unwrap();
    assert_eq!(page.head_seq, 3);
    assert_eq!(page.events.len(), 3);
    // Ordered strictly by seq.
    assert!(page.events.windows(2).all(|w| w[0].seq < w[1].seq));
    assert_eq!(page.events[0].seq, 1);
    assert_eq!(page.events[0].path, "a.md");
    assert_eq!(page.events[0].content_hash.as_deref(), Some("h1"));

    // A cursor past the tip returns nothing but still reports the head.
    let page2 = db.get_file_changes_since_seq(&vid, 2).await.unwrap();
    assert_eq!(page2.events.len(), 1);
    assert_eq!(page2.events[0].seq, 3);
    assert_eq!(page2.head_seq, 3);

    let empty = db.get_file_changes_since_seq(&vid, 3).await.unwrap();
    assert!(empty.events.is_empty());
    assert_eq!(empty.head_seq, 3);
}

#[tokio::test]
async fn seq_is_isolated_per_vault() {
    let tmp = TempDir::new().unwrap();
    let db = open_db(&tmp).await;
    let v1 = make_vault(&db, &tmp).await;
    // A second vault under a different directory.
    let dir2 = tmp.path().join("vault2");
    std::fs::create_dir_all(&dir2).unwrap();
    let v2 = db
        .create_vault("V2".to_string(), dir2.to_string_lossy().to_string())
        .await
        .unwrap()
        .id;

    db.log_file_change(&v1, "a.md", "created", Some("x"), None, None, 0)
        .await
        .unwrap();
    // v2's sequence starts fresh at 1, independent of v1.
    let s = db
        .log_file_change(&v2, "a.md", "created", Some("y"), None, None, 0)
        .await
        .unwrap();
    assert_eq!(s, Some(1));
}

#[tokio::test]
async fn migration_is_idempotent() {
    let tmp = TempDir::new().unwrap();
    // Opening the same database twice re-runs migrations; it must not error and
    // must preserve the sequence counter.
    let db_url = format!("sqlite://{}", tmp.path().join("idem.db").display());
    let vault_dir = tmp.path().join("v");
    std::fs::create_dir_all(&vault_dir).unwrap();

    let vid = {
        let db = Database::new(&db_url).await.unwrap();
        let vid = db
            .create_vault("V".to_string(), vault_dir.to_string_lossy().to_string())
            .await
            .unwrap()
            .id;
        db.log_file_change(&vid, "a.md", "created", Some("h"), None, None, 0)
            .await
            .unwrap();
        vid
    };

    let db2 = Database::new(&db_url).await.unwrap();
    // Sequence continues rather than restarting at 1.
    let s = db2
        .log_file_change(&vid, "b.md", "created", Some("h2"), None, None, 0)
        .await
        .unwrap();
    assert_eq!(s, Some(2));
}

#[test]
fn manifest_hashes_files_and_skips_dot_entries() {
    let tmp = TempDir::new().unwrap();
    let vault = tmp.path();
    std::fs::write(vault.join("note.md"), b"hello").unwrap();
    std::fs::create_dir_all(vault.join("sub")).unwrap();
    std::fs::write(vault.join("sub/child.md"), b"world").unwrap();
    // Dot-directory content must be excluded.
    std::fs::create_dir_all(vault.join(".obsidian")).unwrap();
    std::fs::write(vault.join(".obsidian/app.json"), b"{}").unwrap();

    let manifest = FileService::build_manifest(&vault.to_string_lossy()).unwrap();
    let paths: Vec<&str> = manifest.iter().map(|e| e.path.as_str()).collect();
    assert!(paths.contains(&"note.md"));
    assert!(paths.contains(&"sub/child.md"));
    assert!(!paths.iter().any(|p| p.contains(".obsidian")));

    // Hash matches the shared content-hash helper (SHA-256 of raw bytes).
    let note = manifest.iter().find(|e| e.path == "note.md").unwrap();
    assert_eq!(note.content_hash, FileService::hash_bytes(b"hello"));
    assert_eq!(note.size, 5);
}
