//! Per-platform window setup. Everything OS-specific lives behind these three
//! functions so the rest of the app never needs a `cfg` block.

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;

use tauri::WebviewWindow;

/// Turn the plain Tauri window into whatever the platform needs it to be.
/// Called once at startup, before the window is shown.
pub fn configure(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    macos::configure(window);
    #[cfg(target_os = "windows")]
    windows::configure(window);
    #[cfg(target_os = "linux")]
    linux::configure(window);
}

/// Show the dock without taking focus from whatever the user is working in.
pub fn show(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    macos::show(window);
    #[cfg(not(target_os = "macos"))]
    if let Err(error) = window.show() {
        log::error!("platform: failed to show window: {error}");
    }
}
