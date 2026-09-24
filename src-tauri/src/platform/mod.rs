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

/// Keep the window out of screen shares, recordings and screenshots.
///
/// macOS sets `NSWindow.sharingType` to `none` and Windows calls
/// `SetWindowDisplayAffinity`, both through Tauri. **Linux has no equivalent**:
/// neither X11 nor the Wayland protocols this app can reach let a window ask not
/// to be captured, so the call does nothing there and the setting is not offered
/// (`capture_protection_supported`).
///
/// On macOS this runs after the NSPanel conversion, and it survives it: the
/// panel is the same window object with a different class, and `sharingType` is
/// a property of the object.
pub fn set_hidden_from_capture(window: &WebviewWindow, hidden: bool) {
    if !capture_protection_supported() {
        return;
    }
    if let Err(error) = window.set_content_protected(hidden) {
        log::error!("platform: failed to set content protection: {error}");
    }
}

/// Whether this platform can keep a window out of a capture at all, so the
/// settings view can leave out a switch that would do nothing.
#[must_use]
pub const fn capture_protection_supported() -> bool {
    cfg!(any(target_os = "macos", target_os = "windows"))
}

/// The clipboard's change count, and whether what is on it asked not to be
/// remembered, for the clipboard history (`clips.rs`).
///
/// macOS only: `NSPasteboard.changeCount` moves on every copy, so the text is
/// read only when something was copied, and password managers mark their copies
/// with the nspasteboard.org types. Elsewhere this is `None`, and the history
/// compares the text itself and has no such marker to honour.
#[must_use]
pub fn clipboard_state() -> Option<(isize, bool)> {
    #[cfg(target_os = "macos")]
    return Some(macos::clipboard_state());
    #[cfg(not(target_os = "macos"))]
    None
}

/// Image files chosen in the system's open panel, or `None` where the webview's
/// own file input is the picker (everywhere but macOS). Blocks until the panel
/// is closed; call from a thread that may wait, not the main thread.
#[must_use]
pub fn pick_images(app: &tauri::AppHandle) -> Option<Vec<std::path::PathBuf>> {
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = std::sync::mpsc::channel();
        if let Err(error) = app.run_on_main_thread(move || {
            // The receiver outlives this unless the app is going away.
            let _ = sender.send(macos::pick_images());
        }) {
            log::error!("platform: could not open the image picker: {error}");
            return Some(Vec::new());
        }
        Some(receiver.recv().unwrap_or_default())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        None
    }
}
