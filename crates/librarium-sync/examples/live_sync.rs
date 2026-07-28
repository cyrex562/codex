//! Headless end-to-end smoke test of the sync engine against a LIVE remote
//! Librarium server. This is the exact `SyncEngine` the desktop app embeds — the
//! only thing missing is the Tauri GUI shell.
//!
//! It NEVER touches an existing vault: it creates a fresh throwaway remote vault,
//! syncs a local temp vault against it, exercises push / pull / conflict, prints
//! a PASS/FAIL report, and deletes the throwaway vault at the end.
//!
//! Usage:
//!   LIBRARIUM_URL=http://100.123.8.84:8080 \
//!   LIBRARIUM_API_KEY=obh_... \
//!   cargo run -p librarium-sync --example live_sync
//!
//! Optional: LIBRARIUM_KEEP=1 to leave the remote test vault in place.

use librarium_client::ObsidianClient;
use librarium_sync::SyncEngine;
use librarium_types::CreateVaultRequest;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

type BoxErr = Box<dyn std::error::Error>;

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("\n\x1b[31mharness error:\x1b[0m {e}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), BoxErr> {
    let base_url = std::env::var("LIBRARIUM_URL")?;
    let api_key = std::env::var("LIBRARIUM_API_KEY")?;
    let keep = std::env::var("LIBRARIUM_KEEP").is_ok();

    let client = ObsidianClient::for_cloud(base_url.clone()).with_api_key(api_key.clone());

    // 1. Create a throwaway remote vault (unique name; server picks the path).
    let stamp = Instant::now().elapsed().as_nanos(); // just for a bit of uniqueness
    let vault_name = format!("synctest-{}", std::process::id().wrapping_add(stamp as u32));
    println!("→ creating remote test vault '{vault_name}'");
    let remote_vault = client
        .create_vault(&CreateVaultRequest {
            name: vault_name.clone(),
            path: None,
        })
        .await?;
    println!("  remote vault id = {}", remote_vault.id);

    // Run the scenario, always cleaning up the remote vault afterwards.
    let result = scenario(&client, &base_url, &api_key, &remote_vault.id).await;

    if keep {
        println!(
            "\n(LIBRARIUM_KEEP set — leaving remote vault {} in place)",
            remote_vault.id
        );
    } else {
        println!("\n→ deleting remote test vault {}", remote_vault.id);
        if let Err(e) = client.delete_vault(&remote_vault.id).await {
            eprintln!("  warning: cleanup failed: {e}");
        }
    }

    result
}

async fn scenario(
    client: &ObsidianClient,
    base_url: &str,
    api_key: &str,
    remote_vault_id: &str,
) -> Result<(), BoxErr> {
    let mut report = Report::default();

    // 2. Build a local temp vault with a few notes (like a desktop vault).
    let local = tempdir()?;
    write_file(&local, "welcome.md", b"# Welcome\n\nfirst note")?;
    write_file(&local, "projects/ideas.md", b"- sync\n- notes")?;
    write_file(&local, "assets/logo.bin", &[0u8, 1, 2, 3, 250, 200, 255])?;

    // 3. Start the sync engine: local temp vault -> remote test vault.
    let sync_db = local.join("_sync.db");
    let engine = SyncEngine::open(&sync_db).await?;
    let remote_id = engine
        .add_remote(
            "live".to_string(),
            base_url.to_string(),
            api_key.to_string(),
        )
        .await?;
    engine
        .map_vault(
            remote_id.clone(),
            "local-test".to_string(),
            local.to_string_lossy().to_string(),
            remote_vault_id.to_string(),
        )
        .await?;
    engine.start().await?;
    println!(
        "→ sync engine started (local {:?} -> remote {})",
        local, remote_vault_id
    );

    // 4. PUSH: the three local notes should appear on the server.
    let pushed = wait_until(Duration::from_secs(30), || async {
        let m = client.get_manifest(remote_vault_id).await.ok()?;
        let paths: Vec<&str> = m.iter().map(|e| e.path.as_str()).collect();
        let ok = paths.contains(&"welcome.md")
            && paths.contains(&"projects/ideas.md")
            && paths.contains(&"assets/logo.bin");
        ok.then_some(m)
    })
    .await;
    match &pushed {
        Some(m) => {
            // Hash of the pushed binary must match what we wrote (byte-exact).
            let logo = m.iter().find(|e| e.path == "assets/logo.bin");
            let hash_ok = logo
                .map(|e| e.content_hash == sha256_hex(&[0u8, 1, 2, 3, 250, 200, 255]))
                .unwrap_or(false);
            report.check("push: local notes appear on server", true);
            report.check("push: binary byte-exact (hash match)", hash_ok);
        }
        None => report.check("push: local notes appear on server", false),
    }

    // 5. PULL: change a file on the server; it should reach the local vault.
    println!("→ editing welcome.md on the server");
    client
        .upload_file_bytes(
            remote_vault_id,
            "welcome.md",
            b"# Welcome\n\nEDITED ON SERVER".to_vec(),
        )
        .await?;
    let pulled = wait_until(Duration::from_secs(30), || async {
        let bytes = std::fs::read(local.join("welcome.md")).ok()?;
        (bytes == b"# Welcome\n\nEDITED ON SERVER").then_some(())
    })
    .await;
    report.check("pull: server edit reaches local vault", pulled.is_some());

    // 6. CONFLICT (keep-both): diverge the same path on both sides while the
    //    engine is briefly stopped, then restart and expect a conflict_ copy.
    println!("→ creating a divergent edit on both sides");
    engine.stop();
    // give the watcher a moment to settle, then diverge
    tokio::time::sleep(Duration::from_millis(300)).await;
    std::fs::write(local.join("projects/ideas.md"), b"LOCAL divergent edit")?;
    client
        .upload_file_bytes(
            remote_vault_id,
            "projects/ideas.md",
            b"REMOTE divergent edit".to_vec(),
        )
        .await?;
    engine.start().await?;

    let conflict_ok = wait_until(Duration::from_secs(30), || async {
        // A conflict_ sibling for ideas.md should exist locally, and no data lost:
        // the canonical file holds the server (winner) content.
        let dir = local.join("projects");
        let entries = std::fs::read_dir(&dir).ok()?;
        let has_conflict = entries.filter_map(|e| e.ok()).any(|e| {
            e.file_name()
                .to_string_lossy()
                .starts_with("conflict_ideas_")
        });
        let canonical = std::fs::read(dir.join("ideas.md")).ok()?;
        (has_conflict && canonical == b"REMOTE divergent edit").then_some(())
    })
    .await;
    report.check(
        "conflict: keep-both copy created, server wins canonical",
        conflict_ok.is_some(),
    );

    engine.stop();
    report.finish();
    if report.all_passed() {
        Ok(())
    } else {
        Err("one or more sync checks failed".into())
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────

#[derive(Default)]
struct Report {
    rows: Vec<(String, bool)>,
}
impl Report {
    fn check(&mut self, name: &str, pass: bool) {
        println!(
            "  [{}] {name}",
            if pass {
                "\x1b[32mPASS\x1b[0m"
            } else {
                "\x1b[31mFAIL\x1b[0m"
            }
        );
        self.rows.push((name.to_string(), pass));
    }
    fn all_passed(&self) -> bool {
        self.rows.iter().all(|(_, p)| *p)
    }
    fn finish(&self) {
        let passed = self.rows.iter().filter(|(_, p)| *p).count();
        println!("\n=== {passed}/{} checks passed ===", self.rows.len());
    }
}

async fn wait_until<F, Fut, T>(timeout: Duration, mut f: F) -> Option<T>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Option<T>>,
{
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(v) = f().await {
            return Some(v);
        }
        if Instant::now() >= deadline {
            return None;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

fn tempdir() -> Result<PathBuf, BoxErr> {
    let base = std::env::temp_dir().join(format!("librarium-live-sync-{}", std::process::id()));
    std::fs::create_dir_all(&base)?;
    Ok(base)
}

fn write_file(root: &Path, rel: &str, bytes: &[u8]) -> Result<(), BoxErr> {
    let p = root.join(rel);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(p, bytes)?;
    Ok(())
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    format!("{:x}", h.finalize())
}
