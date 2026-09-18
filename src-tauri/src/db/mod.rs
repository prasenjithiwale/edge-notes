//! SQLite, owned entirely by Rust. The webview never sees SQL, a file path or a
//! connection — only the typed commands in `commands.rs`.

pub mod adopt;
pub mod archive;
pub mod migrations;
pub mod notes;
pub mod settings;
pub mod task_import;
pub mod tasks;

use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use crate::error::AppResult;

pub use archive::{ArchivedItem, ArchivedKind};
pub use notes::{Note, NoteColor};
pub use settings::{Settings, SettingsPatch, Theme};
pub use tasks::{Status, Task, TaskPatch};

/// Unix milliseconds. Every write takes its timestamp as an argument so the
/// repositories stay deterministic under test.
#[must_use]
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        })
}

pub struct Database {
    connection: Mutex<Connection>,
}

impl Database {
    /// Open the database file, apply pragmas and migrate.
    pub fn open(path: &Path) -> AppResult<Self> {
        let connection = Connection::open(path)?;
        Self::prepare(connection)
    }

    /// An isolated in-memory database, for tests.
    pub fn in_memory() -> AppResult<Self> {
        let connection = Connection::open_in_memory()?;
        Self::prepare(connection)
    }

    fn prepare(mut connection: Connection) -> AppResult<Self> {
        // WAL keeps reads from blocking the autosave writes (brief 9.1).
        // NORMAL is the matching durability setting for WAL: safe across app
        // crashes, and we are not holding money in here.
        connection.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;",
        )?;
        migrations::run(&mut connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    /// Run a query. A poisoned lock is recovered rather than propagated: the
    /// connection itself is still valid, and losing notes to a panic elsewhere
    /// would be the worse failure.
    pub fn with<T>(&self, action: impl FnOnce(&Connection) -> AppResult<T>) -> AppResult<T> {
        match self.connection.lock() {
            Ok(connection) => action(&connection),
            Err(poisoned) => action(&poisoned.into_inner()),
        }
    }

    /// Housekeeping at startup: drop notes and tasks soft-deleted more than 30
    /// days ago.
    pub fn purge_expired(&self) -> AppResult<usize> {
        self.with(|connection| {
            let now = now_ms();
            Ok(notes::purge_expired(connection, now)? + tasks::purge_expired(connection, now)?)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_database_is_migrated_and_usable() {
        let db = Database::in_memory().expect("open");
        let listed = db.with(notes::list).expect("list");
        assert!(listed.is_empty());
    }

    #[test]
    fn defaults_are_available_immediately() {
        let db = Database::in_memory().expect("open");
        let loaded = db.with(settings::get).expect("settings");
        assert_eq!(loaded, Settings::default());
    }

    #[test]
    fn a_file_backed_database_persists_across_opens() {
        let dir = std::env::temp_dir().join(format!("ledge-test-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("notes.db");

        let id = {
            let db = Database::open(&path).expect("open");
            let note = db
                .with(|c| notes::create(c, NoteColor::Mint, now_ms()))
                .expect("create");
            note.id
        };

        let reopened = Database::open(&path).expect("reopen");
        let listed = reopened.with(notes::list).expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, id);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn now_ms_is_a_plausible_timestamp() {
        // Later than 2020 and before 2100: enough to catch a unit mix-up.
        let now = now_ms();
        assert!(now > 1_577_836_800_000);
        assert!(now < 4_102_444_800_000);
    }
}
