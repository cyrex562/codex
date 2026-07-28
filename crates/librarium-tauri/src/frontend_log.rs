//! Frontend log file — rotates on every app start.
//!
//! Diagnoses the "closed the laptop overnight, came back to a login screen"
//! class of bugs by giving the frontend a durable place to record what its
//! auth/session/router paths did leading up to the observed crash. The server
//! log lives at `{data_dir}/logs/librarium.log.YYYY-MM-DD` and captures the
//! backend view; this file captures the *frontend* view (Vue store state,
//! refresh attempts, WebSocket reconnects, `logout()` call sites).
//!
//! Rotation: on process startup we cascade `frontend.log.2` → `.3` → drop,
//! `.1` → `.2`, `frontend.log` → `.1`, and start a fresh empty `frontend.log`.
//! Four generations is enough to reconstruct a crash without letting the
//! directory grow unbounded across long-running dev cycles. Each generation
//! carries the log from one full run of the app, so "the last thing before
//! the crash" is always in `frontend.log.1`.
//!
//! Line format: `[RFC3339-TIMESTAMP] LEVEL SOURCE: MESSAGE | k=v k=v` where
//! `LEVEL` is one of `TRACE/DEBUG/INFO/WARN/ERROR` and `SOURCE` is a short
//! module tag chosen by the frontend caller (e.g. `auth`, `router`, `ws`).
//! `context` key/value pairs are optional and appended tail-first for
//! grep-friendliness.

use anyhow::{Context, Result};
use serde::Deserialize;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

const FILE_NAME: &str = "frontend.log";
const KEEP_GENERATIONS: u32 = 3;

/// Managed Tauri state. Holds the resolved log path plus a mutex around the
/// append handle so concurrent commands from the frontend can't tear each
/// other's lines.
pub struct FrontendLog {
    path: PathBuf,
    handle: Mutex<Option<File>>,
}

/// One record as accepted from the frontend `frontend_log` command.
#[derive(Debug, Deserialize)]
pub struct LogRecord {
    pub level: String,
    pub source: String,
    pub message: String,
    /// Free-form context, serialised as `k=v` pairs (values are debug-printed).
    #[serde(default)]
    pub context: serde_json::Map<String, serde_json::Value>,
}

impl FrontendLog {
    /// Prepare the log location, rotate existing generations, and open the
    /// fresh `frontend.log` for append. Call this once at app startup.
    pub fn init(logs_dir: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&logs_dir)
            .with_context(|| format!("Failed to create logs dir {}", logs_dir.display()))?;
        let path = logs_dir.join(FILE_NAME);
        rotate_generations(&path)?;
        let handle = open_append(&path)?;
        Ok(Self {
            path,
            handle: Mutex::new(Some(handle)),
        })
    }

    /// Absolute path of the current log file (for diagnostic surfaces).
    pub fn path_str(&self) -> String {
        self.path.to_string_lossy().into_owned()
    }

    /// Append a single record. Any I/O failure is surfaced as `Err` — the
    /// Tauri command wraps this into a string error the frontend can log to
    /// the console so a filesystem hiccup doesn't silently break diagnostics.
    pub fn append(&self, rec: &LogRecord) -> Result<()> {
        let line = format_line(rec);
        let mut guard = self.handle.lock().unwrap();
        if guard.is_none() {
            // Handle was dropped on a previous error; try to re-open lazily.
            *guard = Some(open_append(&self.path)?);
        }
        let file = guard.as_mut().expect("handle just re-opened");
        writeln!(file, "{line}")
            .with_context(|| format!("Failed to append to {}", self.path.display()))?;
        file.flush().ok();
        Ok(())
    }
}

fn open_append(path: &std::path::Path) -> Result<File> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .with_context(|| format!("Failed to open {} for append", path.display()))
}

/// Cascade `frontend.log.{N-1}` → `.N` for `N` down to 1, dropping the oldest.
/// The current `frontend.log` becomes `frontend.log.1`; nothing new is created
/// here — the caller opens a fresh file for append after this returns.
fn rotate_generations(current: &std::path::Path) -> Result<()> {
    let parent = current.parent().expect("log path has a parent");

    // Drop the oldest generation if it exists.
    let oldest = parent.join(format!("{FILE_NAME}.{KEEP_GENERATIONS}"));
    if oldest.exists() {
        std::fs::remove_file(&oldest)
            .with_context(|| format!("Failed to remove {}", oldest.display()))?;
    }

    // Shift generations from (KEEP_GENERATIONS - 1) down to 1. `.k` becomes
    // `.(k+1)` in the sequence, working from the tail so we don't clobber a
    // slot that still holds data we care about.
    for k in (1..KEEP_GENERATIONS).rev() {
        let from = parent.join(format!("{FILE_NAME}.{k}"));
        let to = parent.join(format!("{FILE_NAME}.{}", k + 1));
        if from.exists() {
            std::fs::rename(&from, &to).with_context(|| {
                format!("Failed to rename {} → {}", from.display(), to.display())
            })?;
        }
    }

    // Finally, promote the current `frontend.log` to `.1`.
    if current.exists() {
        let to = parent.join(format!("{FILE_NAME}.1"));
        std::fs::rename(current, &to).with_context(|| {
            format!("Failed to promote {} → {}", current.display(), to.display())
        })?;
    }

    Ok(())
}

fn format_line(rec: &LogRecord) -> String {
    let ts = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let level = normalise_level(&rec.level);
    let ctx = format_context(&rec.context);
    let head = format!("[{ts}] {level:<5} {}: {}", rec.source, rec.message);
    if ctx.is_empty() {
        head
    } else {
        format!("{head} | {ctx}")
    }
}

fn normalise_level(raw: &str) -> &'static str {
    match raw.to_ascii_uppercase().as_str() {
        "TRACE" => "TRACE",
        "DEBUG" => "DEBUG",
        "WARN" | "WARNING" => "WARN",
        "ERROR" | "ERR" => "ERROR",
        _ => "INFO",
    }
}

fn format_context(ctx: &serde_json::Map<String, serde_json::Value>) -> String {
    let mut parts: Vec<String> = ctx
        .iter()
        .map(|(k, v)| {
            let value = match v {
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            format!("{k}={value}")
        })
        .collect();
    parts.sort();
    parts.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn read(path: &std::path::Path) -> String {
        std::fs::read_to_string(path).unwrap_or_default()
    }

    fn make_record(msg: &str) -> LogRecord {
        LogRecord {
            level: "INFO".into(),
            source: "test".into(),
            message: msg.into(),
            context: serde_json::Map::new(),
        }
    }

    #[test]
    fn init_creates_the_logs_dir_and_starts_a_fresh_file() {
        let dir = TempDir::new().unwrap();
        let logs = dir.path().join("logs");
        let log = FrontendLog::init(logs.clone()).unwrap();
        log.append(&make_record("hello")).unwrap();
        assert!(logs.join(FILE_NAME).exists());
        assert!(read(&logs.join(FILE_NAME)).contains("hello"));
    }

    #[test]
    fn rotate_promotes_current_to_dot_one_on_re_init() {
        let dir = TempDir::new().unwrap();
        let logs = dir.path().join("logs");
        // First run: write a line into the current file.
        {
            let log = FrontendLog::init(logs.clone()).unwrap();
            log.append(&make_record("run-1")).unwrap();
        }
        // Second run: rotation should preserve run-1 as `.1` and start empty.
        let _log2 = FrontendLog::init(logs.clone()).unwrap();
        assert!(read(&logs.join("frontend.log")).is_empty());
        assert!(read(&logs.join("frontend.log.1")).contains("run-1"));
    }

    #[test]
    fn rotate_cascades_older_generations_down_the_ladder() {
        let dir = TempDir::new().unwrap();
        let logs = dir.path().join("logs");
        // Simulate three past runs by writing each in turn.
        {
            let log = FrontendLog::init(logs.clone()).unwrap();
            log.append(&make_record("run-a")).unwrap();
        }
        {
            let log = FrontendLog::init(logs.clone()).unwrap();
            log.append(&make_record("run-b")).unwrap();
        }
        {
            let log = FrontendLog::init(logs.clone()).unwrap();
            log.append(&make_record("run-c")).unwrap();
        }
        // One more init to cascade `run-c` → .1, `run-b` → .2, `run-a` → .3.
        let _log = FrontendLog::init(logs.clone()).unwrap();
        assert!(read(&logs.join("frontend.log")).is_empty());
        assert!(read(&logs.join("frontend.log.1")).contains("run-c"));
        assert!(read(&logs.join("frontend.log.2")).contains("run-b"));
        assert!(read(&logs.join("frontend.log.3")).contains("run-a"));
    }

    #[test]
    fn rotate_drops_the_oldest_beyond_keep_generations() {
        let dir = TempDir::new().unwrap();
        let logs = dir.path().join("logs");
        // Seed `.3` with a marker; on the next init it should vanish.
        std::fs::create_dir_all(&logs).unwrap();
        std::fs::write(logs.join("frontend.log.3"), "oldest").unwrap();
        std::fs::write(logs.join("frontend.log.2"), "older").unwrap();
        std::fs::write(logs.join("frontend.log.1"), "old").unwrap();
        std::fs::write(logs.join("frontend.log"), "current").unwrap();

        let _log = FrontendLog::init(logs.clone()).unwrap();

        assert!(read(&logs.join("frontend.log")).is_empty());
        assert_eq!(read(&logs.join("frontend.log.1")), "current");
        assert_eq!(read(&logs.join("frontend.log.2")), "old");
        assert_eq!(read(&logs.join("frontend.log.3")), "older");
        // "oldest" was dropped.
    }

    #[test]
    fn format_line_includes_timestamp_level_source_and_context() {
        let mut rec = make_record("boot");
        rec.level = "warn".into();
        rec.source = "auth".into();
        rec.context
            .insert("route".into(), serde_json::json!("/login"));
        rec.context.insert("attempt".into(), serde_json::json!(2));

        let line = format_line(&rec);

        assert!(line.contains("WARN"));
        assert!(line.contains("auth:"));
        assert!(line.contains("boot"));
        // Context is sorted alphabetically so the format is deterministic.
        assert!(line.ends_with("attempt=2 route=/login"));
    }

    #[test]
    fn unknown_level_defaults_to_info() {
        assert_eq!(normalise_level("bogus"), "INFO");
        assert_eq!(normalise_level(""), "INFO");
    }
}
