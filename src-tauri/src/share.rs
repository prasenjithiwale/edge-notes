//! Sharing one note with an app that is not this one.
//!
//! Three ways out, because the apps people asked for take three different
//! things: **rich text** on the clipboard (Apple Notes, OneNote, Mail and Word
//! read HTML and none of them read Markdown), **Markdown** on the clipboard
//! (Obsidian, Bear, a code editor), and on macOS the **share sheet**, which is
//! the list of apps the system itself keeps.
//!
//! The note is rendered in the frontend, by the same parser that draws it —
//! there is one answer to what a note says and this is not a second one. Rust
//! is given the finished text and does the part the webview may not: reaching
//! the clipboard and the window server.

use tauri::AppHandle;

use crate::error::{AppError, AppResult};

/// Put a note on the clipboard as rich text *and* as plain text.
///
/// Both flavours in one write: an app that takes HTML gets the formatting, and
/// one that does not gets something readable rather than a page of tags.
pub fn copy_rich(app: &AppHandle, html: &str, text: &str) -> AppResult<()> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard()
        .write_html(html, Some(text))
        .map_err(|error| AppError::Share(error.to_string()))
}

pub fn copy_text(app: &AppHandle, text: &str) -> AppResult<()> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard()
        .write_text(text)
        .map_err(|error| AppError::Share(error.to_string()))
}

/// Whether this platform has a share sheet to offer at all, so the panel can
/// leave the item out rather than draw one that does nothing.
#[must_use]
pub const fn sheet_supported() -> bool {
    cfg!(target_os = "macos")
}
