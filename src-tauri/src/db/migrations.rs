//! Schema migrations: an ordered list of steps tracked with `PRAGMA user_version`
//! and applied in one transaction at startup (brief 9.1).
//!
//! Never edit a migration that has shipped; append a new one instead.

use rusqlite::{Connection, Transaction};

use crate::error::AppResult;

/// Each entry is one schema version. The index plus one is the `user_version`
/// the database reaches after it runs.
const MIGRATIONS: &[&str] = &[
    // v1: notes and settings.
    "
    CREATE TABLE notes (
      id          TEXT PRIMARY KEY,
      content     TEXT NOT NULL DEFAULT '',
      color       TEXT NOT NULL,
      pinned      INTEGER NOT NULL DEFAULT 0,
      sort_order  REAL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      deleted_at  INTEGER
    );
    CREATE INDEX idx_notes_active ON notes (deleted_at, updated_at DESC);

    CREATE TABLE settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    ",
];

#[must_use]
pub fn latest_version() -> i64 {
    MIGRATIONS.len() as i64
}

fn user_version(connection: &Connection) -> AppResult<i64> {
    Ok(connection.query_row("PRAGMA user_version", [], |row| row.get(0))?)
}

fn set_user_version(transaction: &Transaction<'_>, version: i64) -> AppResult<()> {
    // PRAGMA does not accept bound parameters.
    transaction.execute_batch(&format!("PRAGMA user_version = {version}"))?;
    Ok(())
}

/// Bring the database up to the latest version. Safe to call on every start.
pub fn run(connection: &mut Connection) -> AppResult<()> {
    let current = user_version(connection)?;
    let target = latest_version();
    if current >= target {
        return Ok(());
    }

    let transaction = connection.transaction()?;
    for (index, migration) in MIGRATIONS.iter().enumerate() {
        let version = index as i64 + 1;
        if version > current {
            transaction.execute_batch(migration)?;
        }
    }
    set_user_version(&transaction, target)?;
    transaction.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory() -> Connection {
        Connection::open_in_memory().expect("in-memory database")
    }

    #[test]
    fn migrates_a_fresh_database_to_the_latest_version() {
        let mut connection = memory();
        run(&mut connection).expect("migrate");
        assert_eq!(
            user_version(&connection).expect("version"),
            latest_version()
        );
    }

    #[test]
    fn running_twice_is_a_no_op() {
        let mut connection = memory();
        run(&mut connection).expect("first");
        run(&mut connection).expect("second");
        assert_eq!(
            user_version(&connection).expect("version"),
            latest_version()
        );
    }

    #[test]
    fn creates_the_expected_tables_and_index() {
        let mut connection = memory();
        run(&mut connection).expect("migrate");

        let count: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master
                 WHERE (type = 'table' AND name IN ('notes', 'settings'))
                    OR (type = 'index' AND name = 'idx_notes_active')",
                [],
                |row| row.get(0),
            )
            .expect("query");
        assert_eq!(count, 3);
    }

    /// A partially-migrated database must pick up only the steps it is missing.
    #[test]
    fn skips_migrations_already_applied() {
        let mut connection = memory();
        run(&mut connection).expect("migrate");
        connection
            .execute_batch("INSERT INTO settings (key, value) VALUES ('probe', '1')")
            .expect("insert");

        run(&mut connection).expect("migrate again");

        let value: String = connection
            .query_row(
                "SELECT value FROM settings WHERE key = 'probe'",
                [],
                |row| row.get(0),
            )
            .expect("probe survived");
        assert_eq!(value, "1");
    }
}
