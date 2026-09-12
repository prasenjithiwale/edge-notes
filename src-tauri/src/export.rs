//! Exporting every note: one Markdown file each, plus a JSON backup (brief M4).
//!
//! The naming helpers are pure so they can be tested without touching a disk.

use std::path::{Path, PathBuf};

use crate::db::Note;
use crate::error::AppResult;

/// Characters that cannot appear in a file name on the platforms brief 5 targets,
/// plus the ones that merely make a name miserable to type.
const UNSAFE_CHARS: &[char] = &[
    '/', '\\', ':', '*', '?', '"', '<', '>', '|', '\n', '\r', '\t',
];

/// How much of a note's first line to keep in its file name.
const MAX_STEM: usize = 60;

/// The note's title: its first non-empty line, matching what the card shows
/// (brief 6.8). Derived here as well as in the frontend, because the export
/// names files by it and Rust cannot reach into `lib/notes.ts`.
#[must_use]
pub fn first_line(content: &str) -> &str {
    content
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("")
}

/// A file name for a note: its title if it has one, always ending in the tail of
/// its id so two notes called "Groceries" cannot overwrite each other.
#[must_use]
pub fn file_stem(title: &str, id: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| if UNSAFE_CHARS.contains(&c) { ' ' } else { c })
        .collect();
    let trimmed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");

    // Char-wise, so a multi-byte title cannot be cut mid-character.
    let mut stem: String = trimmed.chars().take(MAX_STEM).collect();
    stem = stem.trim().trim_matches('.').to_owned();
    if stem.is_empty() {
        stem = "Untitled".to_owned();
    }

    let suffix: String = id
        .chars()
        .rev()
        .take(8)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{stem} {suffix}")
}

/// `YYYY-MM-DD HHMM` from unix milliseconds, in UTC.
///
/// Hand-rolled rather than adding a date crate for one folder name: this is the
/// civil-from-days algorithm, which is exact for every date this app can see.
#[must_use]
pub fn timestamp_name(unix_ms: i64) -> String {
    let seconds = unix_ms.div_euclid(1_000);
    let days = seconds.div_euclid(86_400);
    let secs_of_day = seconds.rem_euclid(86_400);

    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };

    format!(
        "{year:04}-{m:02}-{d:02} {:02}{:02}",
        secs_of_day / 3_600,
        (secs_of_day % 3_600) / 60
    )
}

/// Write every note to `parent`, in a new folder named for the time.
///
/// Returns the folder, so the UI can tell the user where their notes went.
pub fn write_all(parent: &Path, notes: &[Note], now_ms: i64) -> AppResult<PathBuf> {
    let directory = parent.join(format!("Edge Notes {}", timestamp_name(now_ms)));
    std::fs::create_dir_all(&directory)?;

    for note in notes {
        let stem = file_stem(first_line(&note.content), &note.id);
        std::fs::write(directory.join(format!("{stem}.md")), &note.content)?;
    }

    // The Markdown is for reading; this is the one that could be restored from.
    let json = serde_json::to_string_pretty(notes)?;
    std::fs::write(directory.join("notes.json"), json)?;

    Ok(directory)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_title_is_the_first_non_empty_line() {
        assert_eq!(first_line("Standup notes\nDeploy the fix"), "Standup notes");
        assert_eq!(first_line("\n\n  \nGroceries\nMilk"), "Groceries");
        assert_eq!(first_line("   "), "");
    }

    #[test]
    fn a_stem_keeps_the_title_and_the_id_tail() {
        let stem = file_stem("Standup notes", "01930000-0000-7000-8000-0000000000ab");
        assert_eq!(stem, "Standup notes 000000ab");
    }

    #[test]
    fn two_notes_with_the_same_title_get_different_names() {
        let a = file_stem("Groceries", "01930000-0000-7000-8000-00000000000a");
        let b = file_stem("Groceries", "01930000-0000-7000-8000-00000000000b");
        assert_ne!(a, b);
    }

    #[test]
    fn a_title_cannot_escape_the_folder_it_is_written_into() {
        let stem = file_stem("../../etc/passwd", "0193abcd");
        // No separators and no leading dot, so it stays one visible file inside
        // the export folder. Dots left in the middle are just part of a name.
        assert!(!stem.contains('/'));
        assert!(!stem.contains('\\'));
        assert!(!stem.starts_with('.'));

        let path = std::path::Path::new("/tmp/export").join(format!("{stem}.md"));
        assert_eq!(path.parent(), Some(std::path::Path::new("/tmp/export")));
    }

    #[test]
    fn a_title_of_nothing_but_dots_still_gets_a_name() {
        let stem = file_stem("...", "0193abcd");
        assert!(stem.starts_with("Untitled"));
    }

    #[test]
    fn an_empty_title_still_produces_a_name() {
        assert!(file_stem("", "0193abcd").starts_with("Untitled"));
        assert!(file_stem("   ", "0193abcd").starts_with("Untitled"));
    }

    #[test]
    fn a_long_title_is_cut_without_splitting_a_character() {
        let stem = file_stem(&"é".repeat(200), "0193abcd");
        assert!(stem.chars().count() <= MAX_STEM + 9);
    }

    #[test]
    fn the_timestamp_reads_as_a_date() {
        // 2026-09-13T00:00:00Z
        assert_eq!(timestamp_name(1_789_257_600_000), "2026-09-13 0000");
        // The unix epoch, as a sanity check on the civil-from-days maths.
        assert_eq!(timestamp_name(0), "1970-01-01 0000");
        // A leap day, which naive month arithmetic gets wrong.
        assert_eq!(timestamp_name(1_709_164_800_000), "2024-02-29 0000");
    }
}
