//! Schema migrations: an ordered list of steps tracked with `PRAGMA user_version`
//! and applied in one transaction at startup (brief 9.1).
//!
//! Never edit a migration that has shipped; append a new one instead.

use rusqlite::{Connection, Transaction, params};

use crate::error::AppResult;

use super::task_import;
use super::tasks::Task;

/// A migration is either schema, or a change to the data that needs more than
/// SQL can say. Both run inside the same transaction as everything else.
enum Migration {
    Sql(&'static str),
    Code(fn(&Transaction<'_>) -> AppResult<()>),
}

/// Each entry is one schema version. The index plus one is the `user_version`
/// the database reaches after it runs.
const MIGRATIONS: &[Migration] = &[
    // v1: notes and settings.
    Migration::Sql(
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
    ),
    // v2: tasks get a table of their own, instead of being `- [ ]` lines in a
    // note. `repeat_rule` rather than `repeat`, which reads as the SQL function.
    // `sort_order` is reserved for manual ordering, as notes' is.
    Migration::Sql(
        "
    CREATE TABLE tasks (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL DEFAULT '',
      notes       TEXT NOT NULL DEFAULT '',
      done_at     INTEGER,
      due_date    TEXT,
      due_time    TEXT,
      priority    TEXT,
      repeat_rule TEXT,
      sort_order  REAL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      deleted_at  INTEGER
    );
    CREATE INDEX idx_tasks_active ON tasks (deleted_at, done_at, due_date);
    ",
    ),
    // v3: move the tasks that are already written into notes.
    Migration::Code(import_tasks_from_notes),
];

/// Lift every `- [ ]` line out of every note and into `tasks`, once.
///
/// Notes and tasks were the same thing until v2, so leaving the lines where they
/// were would have shown every existing task twice — once in its note, once in
/// the Tasks tab — with no connection between them. The lines are removed as
/// they are imported.
///
/// A note that held nothing but tasks is soft-deleted rather than left as an
/// empty card: the dedicated "Tasks" note existed only to carry them. Soft, so
/// it is recoverable, and so a mistake here is not permanent.
///
/// Timestamps come from the note, not from now, so an imported task keeps the
/// age it had; the line's position is added to `created_at` to keep the order
/// the tasks were written in.
fn import_tasks_from_notes(transaction: &Transaction<'_>) -> AppResult<()> {
    let rows: Vec<(String, String, i64, i64)> = {
        let mut statement = transaction.prepare(
            "SELECT id, content, created_at, updated_at FROM notes WHERE deleted_at IS NULL",
        )?;
        let mapped = statement.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?;
        mapped.collect::<rusqlite::Result<Vec<_>>>()?
    };

    for (id, content, created_at, updated_at) in rows {
        let extracted = task_import::extract(&content);
        if extracted.tasks.is_empty() {
            continue;
        }

        for (index, imported) in extracted.tasks.into_iter().enumerate() {
            let offset = i64::try_from(index).unwrap_or(0);
            let task = Task {
                id: uuid::Uuid::now_v7().to_string(),
                title: imported.title,
                notes: String::new(),
                // The old format recorded that a task was done, never when.
                done_at: imported.done.then_some(updated_at),
                due_date: imported.due_date,
                due_time: imported.due_time,
                priority: imported.priority,
                repeat: imported.repeat,
                created_at: created_at + offset,
                updated_at,
            };
            super::tasks::insert(transaction, &task)?;
        }

        if task_import::is_leftover_empty(&extracted.content) {
            transaction.execute(
                "UPDATE notes SET deleted_at = ?2 WHERE id = ?1",
                params![id, updated_at],
            )?;
        } else {
            // `updated_at` is left alone: this is not an edit the user made, and
            // bumping it would reshuffle the notes list on first launch.
            transaction.execute(
                "UPDATE notes SET content = ?2 WHERE id = ?1",
                params![id, extracted.content],
            )?;
        }
    }
    Ok(())
}

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
            match migration {
                Migration::Sql(sql) => transaction.execute_batch(sql)?,
                Migration::Code(step) => step(&transaction)?,
            }
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
                 WHERE (type = 'table' AND name IN ('notes', 'settings', 'tasks'))
                    OR (type = 'index' AND name IN ('idx_notes_active', 'idx_tasks_active'))",
                [],
                |row| row.get(0),
            )
            .expect("query");
        assert_eq!(count, 5);
    }

    /// A database from before v2, with notes carrying tasks as `- [ ]` lines.
    fn v1_with_notes(notes: &[(&str, &str)]) -> Connection {
        let connection = memory();
        connection
            .execute_batch(
                "CREATE TABLE notes (
                   id TEXT PRIMARY KEY, content TEXT NOT NULL DEFAULT '', color TEXT NOT NULL,
                   pinned INTEGER NOT NULL DEFAULT 0, sort_order REAL,
                   created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
                 CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                 PRAGMA user_version = 1;",
            )
            .expect("v1 schema");
        for (id, content) in notes {
            connection
                .execute(
                    "INSERT INTO notes (id, content, color, created_at, updated_at)
                     VALUES (?1, ?2, 'yellow', 1000, 2000)",
                    params![id, content],
                )
                .expect("insert note");
        }
        connection
    }

    fn note_content(connection: &Connection, id: &str) -> Option<String> {
        connection
            .query_row(
                "SELECT content FROM notes WHERE id = ?1 AND deleted_at IS NULL",
                params![id],
                |row| row.get(0),
            )
            .ok()
    }

    #[test]
    fn moves_tasks_out_of_notes_and_leaves_the_prose() {
        let mut connection = v1_with_notes(&[(
            "n1",
            "Shopping
- [ ] Milk !high
remember the receipt
- [x] Eggs",
        )]);
        run(&mut connection).expect("migrate");

        let tasks = super::super::tasks::list(&connection).expect("tasks");
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].title, "Milk");
        assert_eq!(tasks[0].done_at, None);
        assert_eq!(tasks[1].title, "Eggs");
        assert_eq!(tasks[1].done_at, Some(2000));
        assert_eq!(
            note_content(&connection, "n1").as_deref(),
            Some(
                "Shopping
remember the receipt"
            )
        );
    }

    #[test]
    fn keeps_the_order_the_tasks_were_written_in() {
        let mut connection = v1_with_notes(&[(
            "n1",
            "- [ ] one
- [ ] two
- [ ] three",
        )]);
        run(&mut connection).expect("migrate");

        let titles: Vec<String> = super::super::tasks::list(&connection)
            .expect("tasks")
            .into_iter()
            .map(|task| task.title)
            .collect();
        assert_eq!(titles, ["one", "two", "three"]);
    }

    /// The note that existed only to hold tasks has nothing left to show.
    #[test]
    fn soft_deletes_a_note_that_was_only_a_task_list() {
        let mut connection = v1_with_notes(&[(
            "n1",
            "Tasks
- [ ] Call the bank",
        )]);
        run(&mut connection).expect("migrate");

        assert_eq!(note_content(&connection, "n1"), None);
        let deleted_at: Option<i64> = connection
            .query_row("SELECT deleted_at FROM notes WHERE id = 'n1'", [], |row| {
                row.get(0)
            })
            .expect("row");
        assert_eq!(deleted_at, Some(2000));
        assert_eq!(
            super::super::tasks::list(&connection).expect("tasks").len(),
            1
        );
    }

    #[test]
    fn leaves_a_note_with_no_tasks_exactly_as_it_was() {
        let mut connection = v1_with_notes(&[(
            "n1",
            "Just a thought
- a bullet",
        )]);
        run(&mut connection).expect("migrate");

        assert_eq!(
            note_content(&connection, "n1").as_deref(),
            Some(
                "Just a thought
- a bullet"
            )
        );
        assert!(
            super::super::tasks::list(&connection)
                .expect("tasks")
                .is_empty()
        );
    }

    /// The import is a migration, so it happens once; tasks added afterwards are
    /// not joined by a second copy of the same lines.
    #[test]
    fn imports_only_once() {
        let mut connection = v1_with_notes(&[(
            "n1",
            "List
- [ ] Milk",
        )]);
        run(&mut connection).expect("migrate");
        run(&mut connection).expect("migrate again");

        assert_eq!(
            super::super::tasks::list(&connection).expect("tasks").len(),
            1
        );
    }

    #[test]
    fn a_fresh_database_has_no_tasks_to_import() {
        let mut connection = memory();
        run(&mut connection).expect("migrate");
        assert!(
            super::super::tasks::list(&connection)
                .expect("tasks")
                .is_empty()
        );
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
