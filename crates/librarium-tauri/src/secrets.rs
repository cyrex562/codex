//! Where a remote's API key is actually stored for [`crate::sync_bridge::SyncHandle`].
//!
//! Production code uses [`OsKeyringStore`], backed by the platform's native
//! credential store via the `keyring` crate (Keychain / Credential Manager /
//! Secret Service — desktop-only, hence no Android Keystore branch here,
//! unlike `librarium-mobile`'s equivalent module this one mirrors). Tests use
//! [`InMemorySecretStore`] instead: CI runners have no session D-Bus /
//! keyring daemon for the real desktop backend to connect to, so exercising
//! it there would be flaky at best and hang at worst.

use std::collections::HashMap;
use std::sync::Mutex;

/// Persists, retrieves, or erases one remote's API key, keyed by remote id.
pub trait SecretStore: Send + Sync {
    fn set(&self, remote_id: &str, api_key: &str) -> anyhow::Result<()>;
    fn get(&self, remote_id: &str) -> anyhow::Result<Option<String>>;
    fn clear(&self, remote_id: &str) -> anyhow::Result<()>;
}

/// Namespaces every entry this crate creates in the platform credential
/// store, so it doesn't collide with another app's entries (or with
/// `librarium-mobile`'s own "librarium-mobile"-namespaced entries, though in
/// practice the two never share a keyring — mobile is Android-only).
const KEYRING_SERVICE: &str = "librarium-desktop-sync";

/// Platform-native secure storage via the `keyring` crate. Unlike
/// `librarium-mobile`'s `OsKeyringStore`, desktop needs no app-bootstrap
/// step — `keyring`'s `v1` API auto-detects Keychain/Credential
/// Manager/Secret Service without a live JNI context.
pub struct OsKeyringStore;

impl SecretStore for OsKeyringStore {
    fn set(&self, remote_id: &str, api_key: &str) -> anyhow::Result<()> {
        keyring::Entry::new(KEYRING_SERVICE, remote_id)?.set_password(api_key)?;
        Ok(())
    }

    fn get(&self, remote_id: &str) -> anyhow::Result<Option<String>> {
        match keyring::Entry::new(KEYRING_SERVICE, remote_id)?.get_password() {
            Ok(key) => Ok(Some(key)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn clear(&self, remote_id: &str) -> anyhow::Result<()> {
        match keyring::Entry::new(KEYRING_SERVICE, remote_id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.into()),
        }
    }
}

/// An in-memory [`SecretStore`], for tests only. Provides none of the
/// security properties of [`OsKeyringStore`] — never use it in production
/// code.
#[derive(Default)]
pub struct InMemorySecretStore(Mutex<HashMap<String, String>>);

impl SecretStore for InMemorySecretStore {
    fn set(&self, remote_id: &str, api_key: &str) -> anyhow::Result<()> {
        self.0
            .lock()
            .unwrap()
            .insert(remote_id.to_string(), api_key.to_string());
        Ok(())
    }

    fn get(&self, remote_id: &str) -> anyhow::Result<Option<String>> {
        Ok(self.0.lock().unwrap().get(remote_id).cloned())
    }

    fn clear(&self, remote_id: &str) -> anyhow::Result<()> {
        self.0.lock().unwrap().remove(remote_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn in_memory_store_round_trips_and_reports_absence() {
        let store = InMemorySecretStore::default();
        assert_eq!(store.get("r1").unwrap(), None);
        store.set("r1", "secret").unwrap();
        assert_eq!(store.get("r1").unwrap(), Some("secret".to_string()));
        store.clear("r1").unwrap();
        assert_eq!(store.get("r1").unwrap(), None);
    }

    #[test]
    fn clearing_an_absent_entry_is_not_an_error() {
        let store = InMemorySecretStore::default();
        store.clear("never-set").unwrap();
    }

    #[test]
    fn entries_are_isolated_per_remote_id() {
        let store = InMemorySecretStore::default();
        store.set("r1", "secret-1").unwrap();
        store.set("r2", "secret-2").unwrap();
        store.clear("r1").unwrap();
        assert_eq!(store.get("r1").unwrap(), None);
        assert_eq!(store.get("r2").unwrap(), Some("secret-2".to_string()));
    }
}
