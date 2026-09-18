//! Carrying the database across the rename.
//!
//! `app_data_dir()` is built from the bundle identifier, so changing the
//! identifier — which is what renaming the app to Ledge did in 0.1.0 — gives the
//! app a new, empty folder beside the old one. Without this, every existing
//! install would open on a fresh database and look as though it had lost
//! everything.
//!
//! The copy is made with `VACUUM INTO` rather than by copying files. A database
//! in WAL mode is three files, and copying only the first loses every commit
//! since the last checkpoint; `VACUUM INTO` writes one consistent file from the
//! live connection and preserves `user_version`, which is how migrations are
//! tracked. The old folder is left alone: a copy that goes wrong should cost
//! nothing, and an older build of the app must still find its data.

use std::path::Path;

use rusqlite::{Connection, params};

use crate::error::AppResult;

/// The identifier Edge Notes shipped under, up to and including 0.0.4.
pub const PREVIOUS_IDENTIFIER: &str = "dev.edgenotes.app";

/// Copy `previous` to `current` if, and only if, there is something to copy and
/// nothing would be overwritten. Returns whether a copy was made.
///
/// Both conditions matter: once the app has run under the new identifier it has
/// its own database, and adopting the old one then would throw away whatever has
/// been written since.
pub fn adopt_database(previous: &Path, current: &Path) -> AppResult<bool> {
    if current.exists() || !previous.exists() {
        return Ok(false);
    }

    let connection = Connection::open(previous)?;
    // `VACUUM INTO` refuses to overwrite, which is the check above made binding.
    connection.execute("VACUUM INTO ?1", params![current.to_string_lossy()])?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{Database, NoteColor, migrations, notes, now_ms};

    fn temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("ledge-adopt-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn a_previous_database_is_adopted_with_its_notes_and_its_schema_version() {
        let dir = temp_dir();
        let previous = dir.join("old.db");
        let current = dir.join("new.db");

        let id = {
            let db = Database::open_with_key(&previous, None).expect("open");
            db.with(|c| notes::create(c, NoteColor::Mint, now_ms()))
                .expect("create")
                .id
        };

        assert!(adopt_database(&previous, &current).expect("adopt"));

        let adopted = Connection::open(&current).expect("open the copy");
        // The migrations are tracked in `user_version`; a copy that lost it
        // would re-run every migration against a database that already has them.
        let version: i64 = adopted
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user_version");
        assert_eq!(version, migrations::latest_version());

        let opened = Database::open_with_key(&current, None).expect("reopen");
        let listed = opened.with(notes::list).expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, id);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn nothing_happens_when_there_is_nothing_to_adopt() {
        let dir = temp_dir();
        assert!(!adopt_database(&dir.join("missing.db"), &dir.join("new.db")).expect("adopt"));
        assert!(!dir.join("new.db").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    /// The important one: a second run must not replace what the app has written.
    #[test]
    fn an_existing_database_is_never_overwritten() {
        let dir = temp_dir();
        let previous = dir.join("old.db");
        let current = dir.join("new.db");

        Database::open_with_key(&previous, None)
            .expect("open")
            .with(|c| notes::create(c, NoteColor::Mint, now_ms()))
            .expect("create");
        let kept = Database::open_with_key(&current, None)
            .expect("open")
            .with(|c| notes::create(c, NoteColor::Blue, now_ms()))
            .expect("create")
            .id;

        assert!(!adopt_database(&previous, &current).expect("adopt"));

        let listed = Database::open_with_key(&current, None)
            .expect("reopen")
            .with(notes::list)
            .expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, kept);

        std::fs::remove_dir_all(&dir).ok();
    }
}
