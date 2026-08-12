//! Durable desktop refresh-token store.
//!
//! The frontend keeps the refresh token in WebView localStorage as the fast
//! path — it survives every normal restart and works before Tauri IPC is even
//! reachable. This module provides a *second*, disk-backed copy inside the
//! app's `data_dir` so a wipe of the WebView UserData folder (uninstall/
//! reinstall of the shell, runtime reset, user clearing browser data through
//! the OS) does not force a re-login when the portable data dir is intact.
//!
//! Format: `{"refresh_token": "..."}` at `{data_dir}/session.json`. The JWT's
//! own `exp` claim carries expiry, so this file stores nothing else. Empty or
//! missing = "no token"; callers treat that as "not logged in".

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

const FILE_NAME: &str = "session.json";

#[derive(Serialize, Deserialize, Default, Debug)]
struct StoredSession {
    #[serde(default)]
    refresh_token: Option<String>,
}

/// Managed Tauri state. The mutex serialises the three token commands so
/// concurrent writes cannot interleave into a torn file.
pub struct SessionStore {
    path: PathBuf,
    lock: Mutex<()>,
}

impl SessionStore {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            path: data_dir.join(FILE_NAME),
            lock: Mutex::new(()),
        }
    }

    pub fn get(&self) -> Result<Option<String>> {
        let _guard = self.lock.lock().unwrap();
        if !self.path.exists() {
            return Ok(None);
        }
        let raw = std::fs::read_to_string(&self.path)
            .with_context(|| format!("Failed to read {}", self.path.display()))?;
        if raw.trim().is_empty() {
            return Ok(None);
        }
        let stored: StoredSession =
            serde_json::from_str(&raw).context("Failed to parse session store")?;
        Ok(stored.refresh_token.filter(|s| !s.is_empty()))
    }

    pub fn set(&self, refresh_token: String) -> Result<()> {
        let _guard = self.lock.lock().unwrap();
        let stored = StoredSession {
            refresh_token: Some(refresh_token),
        };
        let content = serde_json::to_string(&stored)?;
        // Atomic write: sibling temp file + rename. A crash mid-write cannot
        // leave a truncated JSON that fails to parse on the next boot.
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, content)
            .with_context(|| format!("Failed to write {}", tmp.display()))?;
        std::fs::rename(&tmp, &self.path).with_context(|| {
            format!("Failed to move temp into place at {}", self.path.display())
        })?;
        // Restrict permissions on Unix so the token isn't world-readable.
        // Windows uses per-user ACLs by default, so no equivalent step there.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(0o600);
            let _ = std::fs::set_permissions(&self.path, perms);
        }
        Ok(())
    }

    pub fn clear(&self) -> Result<()> {
        let _guard = self.lock.lock().unwrap();
        if self.path.exists() {
            std::fs::remove_file(&self.path)
                .with_context(|| format!("Failed to remove {}", self.path.display()))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn get_returns_none_when_file_absent() {
        let dir = TempDir::new().unwrap();
        let store = SessionStore::new(dir.path().to_path_buf());
        assert_eq!(store.get().unwrap(), None);
    }

    #[test]
    fn set_then_get_roundtrips_the_token() {
        let dir = TempDir::new().unwrap();
        let store = SessionStore::new(dir.path().to_path_buf());
        store.set("t-1".to_string()).unwrap();
        assert_eq!(store.get().unwrap(), Some("t-1".to_string()));
    }

    #[test]
    fn set_overwrites_previous_token() {
        let dir = TempDir::new().unwrap();
        let store = SessionStore::new(dir.path().to_path_buf());
        store.set("first".to_string()).unwrap();
        store.set("second".to_string()).unwrap();
        assert_eq!(store.get().unwrap(), Some("second".to_string()));
    }

    #[test]
    fn clear_removes_the_file() {
        let dir = TempDir::new().unwrap();
        let store = SessionStore::new(dir.path().to_path_buf());
        store.set("t".to_string()).unwrap();
        store.clear().unwrap();
        assert_eq!(store.get().unwrap(), None);
    }

    #[test]
    fn clear_is_idempotent_when_file_absent() {
        let dir = TempDir::new().unwrap();
        let store = SessionStore::new(dir.path().to_path_buf());
        store.clear().unwrap();
        store.clear().unwrap();
    }

    #[test]
    fn empty_refresh_token_field_is_treated_as_absent() {
        let dir = TempDir::new().unwrap();
        let store = SessionStore::new(dir.path().to_path_buf());
        std::fs::write(dir.path().join(FILE_NAME), r#"{"refresh_token":""}"#).unwrap();
        assert_eq!(store.get().unwrap(), None);
    }

    #[test]
    fn corrupt_file_surfaces_an_error_not_a_silent_none() {
        let dir = TempDir::new().unwrap();
        let store = SessionStore::new(dir.path().to_path_buf());
        std::fs::write(dir.path().join(FILE_NAME), "not json").unwrap();
        assert!(store.get().is_err());
    }
}
