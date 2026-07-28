use std::process::Command;

fn main() {
    // Embed git commit hash (short). Falls back to "unknown" if git is unavailable
    // (e.g., building from a source tarball without .git/).
    let git_hash = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok()
            } else {
                None
            }
        })
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    // Embed build date (UTC, ISO 8601 date only: YYYY-MM-DD).
    let build_date = std::env::var("SOURCE_DATE_EPOCH")
        .ok()
        .and_then(|epoch| epoch.parse::<i64>().ok())
        .map(|secs| {
            let dt = std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs as u64);
            let secs_since = dt
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            // Simple ISO date from epoch seconds (no chrono dependency in build.rs)
            let days = secs_since / 86400;
            // Convert Julian Day Number to Gregorian calendar
            let z = days + 719468;
            let era = z / 146097;
            let doe = z - era * 146097;
            let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
            let y = yoe + era * 400;
            let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
            let mp = (5 * doy + 2) / 153;
            let d = doy - (153 * mp + 2) / 5 + 1;
            let m = if mp < 10 { mp + 3 } else { mp - 9 };
            let y = if m <= 2 { y + 1 } else { y };
            format!("{:04}-{:02}-{:02}", y, m, d)
        })
        .unwrap_or_else(|| {
            // Fall back to the build timestamp via a fixed string when SOURCE_DATE_EPOCH
            // is not set (non-reproducible build). We embed the date at compile time
            // using the VERGEN_BUILD_DATE pattern — here we just emit it manually.
            //
            // NOTE: This will change on every rebuild, which is expected behaviour for
            // development builds. Release CI should set SOURCE_DATE_EPOCH.
            let output = Command::new("date")
                .args(["-u", "+%Y-%m-%d"])
                .output()
                .ok()
                .and_then(|o| {
                    if o.status.success() {
                        String::from_utf8(o.stdout).ok()
                    } else {
                        None
                    }
                })
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|| "unknown".to_string());
            output
        });

    println!("cargo:rustc-env=GIT_HASH={}", git_hash);
    println!("cargo:rustc-env=BUILD_DATE={}", build_date);

    // Re-run only when HEAD pointer or the index changes. These paths are
    // relative to the crate root (crates/librarium-server/), so they must climb
    // to the repo root where .git actually lives — otherwise cargo watches
    // nonexistent paths, treats them as perpetually changed, and re-runs this
    // script (and often recompiles the crate) on every single build.
    println!("cargo:rerun-if-changed=../../.git/HEAD");
    println!("cargo:rerun-if-changed=../../.git/index");

    // The Vue SPA is embedded into this binary at compile time via rust-embed
    // (see src/assets.rs, `#[folder = "../../target/frontend/"]`). A proc-macro
    // cannot tell cargo that those files are build inputs, so without help cargo
    // would skip recompiling this crate after a frontend rebuild and ship a STALE
    // embedded UI. Two things fix that:
    //   1. `rerun-if-changed` on the folder so cargo re-runs this script when the
    //      SPA changes (Vite emits freshly-hashed filenames every build).
    //   2. A content stamp emitted as `FRONTEND_STAMP` and referenced from
    //      assets.rs, so the crate's own fingerprint changes when the SPA does —
    //      guaranteeing the assets are re-embedded, not just this script re-run.
    let frontend_dir = std::path::Path::new("../../target/frontend");
    println!("cargo:rerun-if-changed={}", frontend_dir.display());
    println!(
        "cargo:rustc-env=FRONTEND_STAMP={}",
        frontend_stamp(frontend_dir)
    );
}

/// A cheap, dependency-free stamp of the built frontend: each file's relative
/// path plus its length, folded into a hash. Changes whenever any embedded asset
/// is added, removed, or resized (which covers Vite's per-build hashed filenames).
/// Returns "absent" when the folder hasn't been built yet.
fn frontend_stamp(dir: &std::path::Path) -> u64 {
    fn walk(dir: &std::path::Path, acc: &mut Vec<(String, u64)>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, acc);
            } else if let Ok(meta) = entry.metadata() {
                acc.push((path.to_string_lossy().into_owned(), meta.len()));
            }
        }
    }

    if !dir.exists() {
        return 0;
    }
    let mut files = Vec::new();
    walk(dir, &mut files);
    files.sort();

    // FNV-1a over the sorted (path, len) pairs — no external crates needed.
    let mut hash: u64 = 0xcbf29ce484222325;
    for (path, len) in files {
        for byte in path.as_bytes().iter().chain(&len.to_le_bytes()) {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    hash
}
