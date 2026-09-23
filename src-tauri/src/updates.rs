//! Idea 6: the app finds, downloads and installs its own new versions.
//!
//! Everything here is Rust's: the webview has no updater permission and asks
//! through `update_check` and `update_install`. The feed is a static
//! `latest.json` on the public Pages site (the source repository is private),
//! and every file it lists is checked against the public key in
//! `tauri.conf.json` before it is installed.
//!
//! Installing goes through Quit: the download finishes first, *then* the
//! frontend is asked to save what is pending, and only when it answers (or the
//! quit timeout passes) is the new version put in place and the app restarted.
//! A restart that dropped the last keystrokes would be brief 11's data loss by
//! another door.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::utils::config::BundleType;
use tauri::utils::platform::bundle_type;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::error::{AppError, AppResult};

/// Sent when a check finds a newer version, so an open Settings can say so.
pub const UPDATE_EVENT: &str = "update:available";

/// Long enough that the first check never competes with startup.
const FIRST_CHECK_AFTER: Duration = Duration::from_secs(60);
/// A widget runs for weeks from login, so it checks again on its own.
const CHECK_EVERY: Duration = Duration::from_secs(24 * 60 * 60);

/// What the frontend is told about a new version.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
}

impl From<&Update> for UpdateInfo {
    fn from(update: &Update) -> Self {
        Self {
            version: update.version.clone(),
            notes: update.body.clone(),
        }
    }
}

/// Why this copy cannot update itself, or `None` when it can.
///
/// Only the packages the feed carries can be replaced in place. A `.deb` came
/// from the APT repository and `apt upgrade` is what updates it — a second,
/// competing channel asking for a root password would be worse than none. A
/// development build is not an install at all.
#[must_use]
pub fn unavailable_reason(bundle: Option<BundleType>, debug: bool) -> Option<&'static str> {
    if debug {
        return Some("Development builds do not update themselves.");
    }
    match bundle {
        Some(BundleType::App | BundleType::AppImage | BundleType::Nsis | BundleType::Msi) => None,
        Some(BundleType::Deb) => Some("This copy is updated by apt: sudo apt upgrade."),
        _ => Some("This copy was not installed from a package that can update itself."),
    }
}

fn this_copy_unavailable() -> Option<&'static str> {
    unavailable_reason(bundle_type(), cfg!(debug_assertions))
}

#[derive(Default)]
pub struct Updates {
    /// The newest version a check found.
    found: Mutex<Option<Update>>,
    /// Downloaded and verified, waiting for the notes to be saved. Held locked
    /// for the whole install, so the quit timeout cannot exit underneath it.
    ready: Mutex<Option<(Update, Vec<u8>)>>,
    /// A download is under way; a second press must not start another.
    installing: AtomicBool,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Whether this copy can update itself, and what an earlier check found, for
/// a Settings view opened after it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    /// Why this copy cannot update itself; the Settings row says so instead of
    /// offering a button that would only fail.
    pub unavailable: Option<&'static str>,
    pub found: Option<UpdateInfo>,
}

#[must_use]
pub fn status(app: &AppHandle) -> UpdateStatus {
    UpdateStatus {
        unavailable: this_copy_unavailable(),
        found: app
            .try_state::<Updates>()
            .and_then(|updates| lock(&updates.found).as_ref().map(UpdateInfo::from)),
    }
}

/// Ask the feed for a newer version. `None` means this one is current.
pub async fn check(app: &AppHandle) -> AppResult<Option<UpdateInfo>> {
    if let Some(reason) = this_copy_unavailable() {
        return Err(AppError::Update(reason.to_owned()));
    }
    let update = app
        .updater()
        .map_err(update_error)?
        .check()
        .await
        .map_err(update_error)?;
    let Some(update) = update else {
        return Ok(None);
    };
    let info = UpdateInfo::from(&update);
    if let Some(updates) = app.try_state::<Updates>() {
        *lock(&updates.found) = Some(update);
    }
    log::info!("updates: {} is available", info.version);
    if let Err(error) = app.emit(UPDATE_EVENT, &info) {
        log::error!("updates: could not announce {}: {error}", info.version);
    }
    crate::tray::show_update(app, &info.version);
    Ok(Some(info))
}

/// Download the update, then quit through the usual save-first path; the
/// install itself happens in [`finish`].
pub async fn install(app: &AppHandle) -> AppResult<()> {
    let updates = app.state::<Updates>();
    if updates.installing.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let result = download(app, &updates).await;
    if result.is_err() {
        updates.installing.store(false, Ordering::SeqCst);
    }
    result
}

async fn download(app: &AppHandle, updates: &Updates) -> AppResult<()> {
    let known = lock(&updates.found).clone();
    let update = match known {
        Some(update) => update,
        None => {
            check(app).await?;
            lock(&updates.found)
                .clone()
                .ok_or_else(|| AppError::Update("Ledge is up to date.".to_owned()))?
        }
    };
    log::info!("updates: downloading {}", update.version);
    // The signature is checked here, against the key built into this copy.
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(update_error)?;
    *lock(&updates.ready) = Some((update, bytes));
    crate::tray::request_quit(app);
    Ok(())
}

/// The end of every quit: install a downloaded update and restart into it, or
/// just exit. Called once the notes are saved, or when the quit times out.
pub fn finish(app: &AppHandle) {
    if let Some(updates) = app.try_state::<Updates>() {
        let mut ready = lock(&updates.ready);
        if let Some((update, bytes)) = ready.take() {
            log::info!("updates: installing {}", update.version);
            match update.install(bytes) {
                // On Windows the installer has already taken over and this
                // process has exited; elsewhere the new copy is in place.
                Ok(()) => app.restart(),
                Err(error) => log::error!("updates: install failed: {error}"),
            }
        }
    }
    app.exit(0);
}

/// Check a minute after startup and then daily, for as long as the app runs.
pub fn spawn_checks(app: AppHandle) {
    if let Some(reason) = this_copy_unavailable() {
        log::info!("updates: not checking: {reason}");
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(FIRST_CHECK_AFTER);
        loop {
            if let Err(error) = tauri::async_runtime::block_on(check(&app)) {
                // Offline is normal for a laptop; the next day tries again.
                log::info!("updates: check failed: {error}");
            }
            std::thread::sleep(CHECK_EVERY);
        }
    });
}

fn update_error(error: tauri_plugin_updater::Error) -> AppError {
    AppError::Update(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_packages_the_feed_carries_update_themselves() {
        for bundle in [
            BundleType::App,
            BundleType::AppImage,
            BundleType::Nsis,
            BundleType::Msi,
        ] {
            assert_eq!(
                unavailable_reason(Some(bundle.clone()), false),
                None,
                "{bundle:?}"
            );
        }
        assert!(
            unavailable_reason(Some(BundleType::Deb), false).is_some_and(|r| r.contains("apt"))
        );
        assert!(unavailable_reason(Some(BundleType::Rpm), false).is_some());
        assert!(unavailable_reason(None, false).is_some());
    }

    #[test]
    fn a_development_build_never_updates() {
        assert!(unavailable_reason(Some(BundleType::App), true).is_some());
    }
}
