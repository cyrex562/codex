//! Android background reconcile service (#64) — the coarse "wake,
//! reconcile, sleep" counterpart to the always-live per-vault tasks
//! `librarium_mobile::SyncHandle::start` spawns for the foreground case.
//! Android does not let an ordinary backgrounded process hold a live
//! WebSocket open, so this runs inside `tauri-plugin-background-service`'s
//! Android foreground service instead, periodically calling
//! [`librarium_mobile::SyncHandle::reconcile_once`] — the same one-shot
//! reconcile the manual "sync now" command uses.
//!
//! Registered `#[cfg(mobile)]`-only in `run()` — desktop keeps its current
//! always-on `sync_bridge.rs` model, which doesn't need this.

use async_trait::async_trait;
use std::time::Duration;
use tauri::{Manager, Runtime};
use tauri_plugin_background_service::{BackgroundService, ServiceContext, ServiceError};
use tauri_plugin_device_info::DeviceInfoExt;

/// Conservative default: matches Android's own `WorkManager` minimum
/// periodic-job interval, even though this doesn't use WorkManager — no
/// reason to wake more often than that for a coarse drift-repair pass (the
/// engine already reconciles fully in the foreground case too).
const RECONCILE_INTERVAL: Duration = Duration::from_secs(15 * 60);

pub struct MobileSyncService;

impl MobileSyncService {
    pub fn new() -> Self {
        Self
    }
}

impl Default for MobileSyncService {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl<R: Runtime> BackgroundService<R> for MobileSyncService {
    async fn init(&mut self, _ctx: &ServiceContext<R>) -> Result<(), ServiceError> {
        tracing::info!("background sync service starting");
        Ok(())
    }

    async fn run(&mut self, ctx: &ServiceContext<R>) -> Result<(), ServiceError> {
        let mut interval = tokio::time::interval(RECONCILE_INTERVAL);
        interval.tick().await; // consume the immediate first tick

        loop {
            tokio::select! {
                _ = ctx.shutdown.cancelled() => {
                    tracing::info!("background sync service stopping");
                    return Ok(());
                }
                _ = interval.tick() => {
                    self.tick(ctx).await;
                }
            }
        }
    }
}

impl MobileSyncService {
    async fn tick<R: Runtime>(&self, ctx: &ServiceContext<R>) {
        let Some(db) = ctx.app.try_state::<librarium_mobile::MobileDb>() else {
            tracing::warn!("background sync tick: MobileDb not yet managed, skipping");
            return;
        };
        let policy = match db.get_sync_policy().await {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!("background sync tick: failed to read sync policy: {e:#}");
                return;
            }
        };

        if let Some(reason) = self.policy_blocks(ctx, &policy) {
            tracing::info!("background sync tick: skipped ({reason})");
            return;
        }

        let Some(sync) = ctx.app.try_state::<librarium_mobile::SyncHandle>() else {
            tracing::warn!("background sync tick: SyncHandle not yet managed, skipping");
            return;
        };
        match sync.reconcile_once().await {
            Ok(()) => tracing::info!("background sync tick: reconcile complete"),
            Err(e) => tracing::warn!("background sync tick: reconcile failed: {e:#}"),
        }
    }

    /// Returns `Some(reason)` if the current network/battery state violates
    /// `policy` and the tick should be skipped. A device-info read failure
    /// is treated as "don't know, so don't risk it" — skip rather than sync.
    fn policy_blocks<R: Runtime>(
        &self,
        ctx: &ServiceContext<R>,
        policy: &librarium_mobile::SyncPolicy,
    ) -> Option<String> {
        let device_info = ctx.app.device_info();

        if policy.wifi_only {
            match device_info.get_network_info() {
                Ok(net) if net.network_type.as_deref() == Some("wifi") => {}
                Ok(net) => {
                    return Some(format!(
                        "wifi-only is set, current network is {:?}",
                        net.network_type
                    ))
                }
                Err(e) => return Some(format!("could not read network info: {e}")),
            }
        }

        match device_info.get_battery_info() {
            Ok(batt) => {
                let charging = batt.is_charging.unwrap_or(false);
                let below_threshold = batt
                    .level
                    .is_some_and(|level| level < policy.battery_threshold as f32);
                if below_threshold && !charging {
                    return Some(format!(
                        "battery {:?}% is below the {}% threshold and not charging",
                        batt.level, policy.battery_threshold
                    ));
                }
            }
            Err(e) => return Some(format!("could not read battery info: {e}")),
        }

        None
    }
}
