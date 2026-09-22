//! Images pasted or dropped into a note (idea 17).
//!
//! The bytes are a file in the app data folder and the note holds a link to it:
//! `![](ledge://localhost/<name>)`. A note is still plain text, which is the
//! whole reason for the indirection — a base64 blob inside the note would go
//! through the editor, the markdown round trip, export and one day sync, and
//! every one of those is worse at carrying a megabyte than the filesystem is.
//!
//! The webview is given no filesystem permission for this. It hands the bytes
//! to a command and reads them back through a scheme this module serves, so the
//! only paths that exist are ones Rust built out of a name it validated.

use std::path::PathBuf;

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

/// The scheme the webview loads an image through. On Windows the same handler
/// answers `http://ledge.localhost/<name>`; `convertFileSrc` on the frontend is
/// what knows the difference.
pub const SCHEME: &str = "ledge";

/// Bigger than any screenshot worth pasting into a 320 px panel, and small
/// enough that a mis-drop cannot fill the disk.
pub const MAX_BYTES: usize = 16 * 1024 * 1024;

/// Where the files live. Beside `notes.db`, so a backup of the folder is a
/// backup of the notes *and* what they show.
pub fn dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app.path().app_data_dir()?.join("images");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// The format, read from the bytes themselves.
///
/// Never from a name or a mime type the webview supplied: this is what decides
/// that the file written is an image at all, and it is the only check between a
/// paste and the disk.
fn sniff(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        return Some(("png", "image/png"));
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some(("jpg", "image/jpeg"));
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some(("gif", "image/gif"));
    }
    if bytes.len() > 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some(("webp", "image/webp"));
    }
    None
}

/// `<uuid>.<ext>` and nothing else. A name is the only thing the webview gets to
/// say about a path, so it is checked before it is ever joined to one: no
/// separators, no dots of its own, nothing that could climb out of the folder.
fn is_safe_name(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return false;
    };
    matches!(ext, "png" | "jpg" | "gif" | "webp") && uuid::Uuid::parse_str(stem).is_ok()
}

fn mime_of(name: &str) -> &'static str {
    match name.rsplit_once('.').map(|(_, ext)| ext) {
        Some("png") => "image/png",
        Some("jpg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}

/// Write an image and return the name the note should link to.
pub fn save(app: &AppHandle, bytes: &[u8]) -> AppResult<String> {
    if bytes.len() > MAX_BYTES {
        return Err(AppError::InvalidImage("that image is too large".to_owned()));
    }
    let Some((ext, _)) = sniff(bytes) else {
        return Err(AppError::InvalidImage(
            "that is not an image this app can show".to_owned(),
        ));
    };
    let name = format!("{}.{ext}", uuid::Uuid::now_v7());
    std::fs::write(dir(app)?.join(&name), bytes)?;
    Ok(name)
}

/// Copy a file dropped onto the panel into the images folder.
///
/// The path comes from the window server's own drag event, read in Rust: the
/// webview is never given one, and never gets to ask for one to be read. What
/// arrives is still checked by its bytes like anything else.
pub fn import(app: &AppHandle, path: &std::path::Path) -> AppResult<String> {
    let bytes = std::fs::read(path)?;
    save(app, &bytes)
}

/// The file behind a name, for handing to something outside this app (the
/// share sheet). `None` for anything that is not a name this module wrote.
pub fn path(app: &AppHandle, name: &str) -> Option<std::path::PathBuf> {
    if !is_safe_name(name) {
        return None;
    }
    let path = dir(app).ok()?.join(name);
    path.is_file().then_some(path)
}

/// The bytes behind a name, and what to call them. `None` for anything that is
/// not a name this module could have written.
pub fn read(app: &AppHandle, name: &str) -> Option<(Vec<u8>, &'static str)> {
    if !is_safe_name(name) {
        return None;
    }
    let bytes = std::fs::read(dir(app).ok()?.join(name)).ok()?;
    Some((bytes, mime_of(name)))
}

/// Delete image files no note mentions any more.
///
/// Run once at startup, beside the purge of long-deleted notes, because there is
/// no other moment when every note can be read at once and nothing is being
/// typed. **Soft-deleted notes count**: a note in the archive can be restored,
/// and restoring it to a broken image would be a delete that was not undone.
pub fn sweep(app: &AppHandle, connection: &Connection) -> AppResult<usize> {
    let dir = dir(app)?;
    let mut statement = connection.prepare("SELECT content FROM notes")?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;

    let mut kept = std::collections::HashSet::new();
    for content in rows {
        for name in mentioned(&content?) {
            kept.insert(name);
        }
    }

    let mut removed = 0;
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_safe_name(&name) && !kept.contains(&name) {
            match std::fs::remove_file(entry.path()) {
                Ok(()) => removed += 1,
                Err(error) => log::warn!("images: could not remove {name}: {error}"),
            }
        }
    }
    Ok(removed)
}

/// Every image name a note's text links to. Deliberately crude — it looks for
/// the scheme rather than parsing markdown — because the cost of missing one is
/// deleting a picture someone is still using.
fn mentioned(content: &str) -> Vec<String> {
    let mut names = Vec::new();
    let prefix = format!("{SCHEME}://localhost/");
    for (at, _) in content.match_indices(&prefix) {
        let rest = &content[at + prefix.len()..];
        let end = rest
            .find(|c: char| c == ')' || c == '"' || c.is_whitespace())
            .unwrap_or(rest.len());
        let name = &rest[..end];
        if is_safe_name(name) {
            names.push(name.to_owned());
        }
    }
    names
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

    #[test]
    fn only_real_images_are_recognised() {
        assert_eq!(sniff(&PNG).map(|(ext, _)| ext), Some("png"));
        assert_eq!(
            sniff(&[0xff, 0xd8, 0xff, 0x00]).map(|(ext, _)| ext),
            Some("jpg")
        );
        assert_eq!(sniff(b"GIF89a....").map(|(ext, _)| ext), Some("gif"));
        assert_eq!(sniff(b"RIFF1234WEBPVP8 ").map(|(ext, _)| ext), Some("webp"));
        // A script, an empty file, and something that only starts like one.
        assert!(sniff(b"#!/bin/sh\n").is_none());
        assert!(sniff(b"").is_none());
        assert!(sniff(b"RIFF1234WAVE").is_none());
    }

    /// The name is the only thing the webview says about a path, so this is the
    /// check that keeps a request inside the images folder.
    #[test]
    fn a_name_that_could_climb_out_of_the_folder_is_refused() {
        let id = uuid::Uuid::now_v7().to_string();
        assert!(is_safe_name(&format!("{id}.png")));
        assert!(!is_safe_name(&format!("../{id}.png")));
        assert!(!is_safe_name(&format!("{id}.png/../../notes.db")));
        assert!(!is_safe_name("notes.db"));
        assert!(!is_safe_name(&format!("{id}.exe")));
        assert!(!is_safe_name("....png"));
        assert!(!is_safe_name(&id));
    }

    #[test]
    fn a_notes_own_images_are_the_ones_kept() {
        let id = uuid::Uuid::now_v7().to_string();
        let content = format!("see this\n\n![](ledge://localhost/{id}.png)\n");
        assert_eq!(mentioned(&content), vec![format!("{id}.png")]);
        // Not an image name, and not this app's scheme.
        assert!(mentioned("![](ledge://localhost/../notes.db)").is_empty());
        assert!(mentioned("![](https://example.com/cat.png)").is_empty());
    }
}
