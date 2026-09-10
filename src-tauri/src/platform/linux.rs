//! Linux: Wayland cannot position its own windows and GNOME ignores
//! always-on-top, so v1 runs under XWayland (brief 8.10).

use tauri::WebviewWindow;

pub fn configure(_window: &WebviewWindow) {}

/// Force the X11 GDK backend before Tauri or GTK start.
///
/// Must run at the very top of `main`, before any threads exist: in Rust 2024
/// `set_var` is unsafe precisely because it races with other threads reading the
/// environment.
pub fn prepare_display_backend() {
    let is_wayland = std::env::var("XDG_SESSION_TYPE")
        .map(|value| value.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false);
    let opted_out = std::env::var("EDGE_NOTES_NATIVE_WAYLAND").is_ok_and(|value| value == "1");

    if is_wayland && !opted_out {
        // SAFETY: called as the first statement in main, before any thread is
        // spawned, so nothing else can be reading the environment concurrently.
        unsafe {
            std::env::set_var("GDK_BACKEND", "x11");
        }
    }
}
