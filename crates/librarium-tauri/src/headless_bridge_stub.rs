//! JNI stub satisfying `tauri-plugin-background-service`'s "headless core
//! bridge" (#64).
//!
//! `tauri-plugin-background-service` (1.0.1) ships a `BackgroundService<R>`
//! trait meant to be usable standalone — its README's quick-start example
//! and `HeadlessBridge.kt`'s own doc comment ("the lifecycle-only path
//! \[plain foreground service + Rust `BackgroundService<R>` task\] is
//! unaffected" by a missing native-core bridge) both say so. In practice,
//! `LifecycleService.kt`'s `onStartCommand` unconditionally calls
//! `HeadlessBridge.start(...)` — a JNI call into a *separate*,
//! unrelated-to-us "headless core" feature (used by the plugin's own
//! calling/messaging support) — and tears the whole foreground service down
//! (`stopSelf()`) if that call doesn't return `accepted: true`. This
//! contradicts the plugin's own documentation — filed as #94, not something
//! wrong in our setup.
//!
//! Working around it without adopting the plugin's calling/messaging
//! feature set: point `HeadlessBridge.nativeLibName` (Kotlin,
//! `MainActivity.kt`) at our real native library name, and export the JNI
//! symbols it calls (`startCore`/`stopCore`/`notifyNetworkChanged`) as
//! trivial stubs that immediately report success. We do no work through
//! this path — the actual reconcile logic runs entirely through
//! `background_sync.rs`'s `BackgroundService::run()` implementation, which
//! the plugin drives independently of this bridge.

use jni::objects::{JClass, JString};
use jni::sys::jstring;
use jni::JNIEnv;

const ACCEPTED: &str = r#"{"ok":true,"state":"running","message":null,"recoverable":false}"#;

fn respond_accepted(env: &mut JNIEnv) -> jstring {
    match env.new_string(ACCEPTED) {
        Ok(s) => s.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub extern "system" fn Java_app_tauri_backgroundservice_HeadlessBridge_startCore(
    mut env: JNIEnv,
    _class: JClass,
    _data_dir: JString,
    _reason: JString,
) -> jstring {
    respond_accepted(&mut env)
}

#[no_mangle]
pub extern "system" fn Java_app_tauri_backgroundservice_HeadlessBridge_stopCore(
    mut env: JNIEnv,
    _class: JClass,
    _data_dir: JString,
    _reason: JString,
) -> jstring {
    respond_accepted(&mut env)
}

#[no_mangle]
pub extern "system" fn Java_app_tauri_backgroundservice_HeadlessBridge_notifyNetworkChanged(
    mut env: JNIEnv,
    _class: JClass,
) -> jstring {
    respond_accepted(&mut env)
}
