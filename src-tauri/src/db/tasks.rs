//! Tasks storage.
//!
//! Tasks used to be `- [ ]` lines inside notes, gathered into a view. They are
//! their own table from v2 on: a task has its own fields rather than tokens at
//! the end of a line, so the details are typed, queryable, and cannot be broken
//! by editing the sentence around them.
//!
//! Deletes are soft, as notes' are, so undo works and a sync engine can
//! reconcile tombstones later. Dates are local calendar values (`YYYY-MM-DD`
//! and `HH:MM`) rather than instants: "the 20th at 2 pm" means that wherever you
//! are, and all the calendar arithmetic lives in the frontend, which has a
//! timezone and a locale to do it in.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Deserializer, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    High,
    Medium,
    Low,
}

impl Priority {
    pub const ALL: [Self; 3] = [Self::High, Self::Medium, Self::Low];

    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::High => "high",
            Self::Medium => "medium",
            Self::Low => "low",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        Self::ALL
            .into_iter()
            .find(|priority| priority.as_str() == value)
            .ok_or_else(|| AppError::UnknownTaskField("priority", value.to_owned()))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Repeat {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

impl Repeat {
    pub const ALL: [Self; 4] = [Self::Daily, Self::Weekly, Self::Monthly, Self::Yearly];

    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Daily => "daily",
            Self::Weekly => "weekly",
            Self::Monthly => "monthly",
            Self::Yearly => "yearly",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        Self::ALL
            .into_iter()
            .find(|repeat| repeat.as_str() == value)
            .ok_or_else(|| AppError::UnknownTaskField("repeat", value.to_owned()))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    /// A free-text detail field: what the one line of the title has no room for.
    pub notes: String,
    /// When it was completed, or `None` while it is open. The time is kept, not
    /// just the fact, so "done today" is a question the list can answer.
    pub done_at: Option<i64>,
    /// Local `YYYY-MM-DD`, or `None` for a task with no date.
    pub due_date: Option<String>,
    /// Local `HH:MM`, or `None` for a whole-day task.
    pub due_time: Option<String>,
    pub priority: Option<Priority>,
    pub repeat: Option<Repeat>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Tells "the key was absent" from "the key was sent as null".
///
/// Serde collapses both to `None` on a plain `Option`, which would make clearing
/// a due date indistinguishable from not mentioning it. With `default` supplying
/// the outer `None`, anything actually present arrives as `Some`.
fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

/// What a create or update may set. `None` leaves a field alone; a field that
/// can be cleared is a nested `Option`, so "set no due date" and "do not touch
/// the due date" are different requests.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPatch {
    pub title: Option<String>,
    pub notes: Option<String>,
    #[serde(default, deserialize_with = "present")]
    pub due_date: Option<Option<String>>,
    #[serde(default, deserialize_with = "present")]
    pub due_time: Option<Option<String>>,
    #[serde(default, deserialize_with = "present")]
    pub priority: Option<Option<Priority>>,
    #[serde(default, deserialize_with = "present")]
    pub repeat: Option<Option<Repeat>>,
}

/// Tasks soft-deleted longer ago than this are purged at startup, as notes are.
pub const PURGE_AFTER_MS: i64 = 30 * 24 * 60 * 60 * 1000;

const SELECT_COLUMNS: &str =
    "id, title, notes, done_at, due_date, due_time, priority, repeat_rule, created_at, updated_at";

type Row = (
    String,
    String,
    String,
    Option<i64>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    i64,
    i64,
);

fn row_to_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<Row> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
        row.get(9)?,
    ))
}

fn build(raw: Row) -> AppResult<Task> {
    Ok(Task {
        id: raw.0,
        title: raw.1,
        notes: raw.2,
        done_at: raw.3,
        due_date: raw.4,
        due_time: raw.5,
        priority: raw.6.as_deref().map(Priority::parse).transpose()?,
        repeat: raw.7.as_deref().map(Repeat::parse).transpose()?,
        created_at: raw.8,
        updated_at: raw.9,
    })
}

/// Every task that has not been deleted, open and done alike.
///
/// Ordering here is only a stable base — by when a task was made — because what
/// the list actually shows is grouped by due date and sorted by priority, and
/// that depends on the reader's clock and timezone. The frontend does it.
pub fn list(connection: &Connection) -> AppResult<Vec<Task>> {
    let sql = format!(
        "SELECT {SELECT_COLUMNS} FROM tasks WHERE deleted_at IS NULL
         ORDER BY created_at ASC, id ASC"
    );
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map([], row_to_task)?;

    let mut tasks = Vec::new();
    for row in rows {
        tasks.push(build(row?)?);
    }
    Ok(tasks)
}

pub fn get(connection: &Connection, id: &str) -> AppResult<Option<Task>> {
    let sql = format!("SELECT {SELECT_COLUMNS} FROM tasks WHERE id = ?1");
    let raw = connection
        .query_row(&sql, params![id], row_to_task)
        .optional()?;
    raw.map(build).transpose()
}

fn require(connection: &Connection, id: &str) -> AppResult<Task> {
    get(connection, id)?.ok_or_else(|| AppError::TaskNotFound(id.to_owned()))
}

/// Insert a task. Ids are UUID v7, as notes' are: time-ordered and sync-friendly.
pub fn create(connection: &Connection, patch: &TaskPatch, now: i64) -> AppResult<Task> {
    insert(
        connection,
        &Task {
            id: uuid::Uuid::now_v7().to_string(),
            title: patch.title.clone().unwrap_or_default(),
            notes: patch.notes.clone().unwrap_or_default(),
            done_at: None,
            due_date: patch.due_date.clone().flatten(),
            due_time: patch.due_time.clone().flatten(),
            priority: patch.priority.flatten(),
            repeat: patch.repeat.flatten(),
            created_at: now,
            updated_at: now,
        },
    )
}

/// Write a task exactly as given. Used by `create` and by the v3 migration,
/// which has to keep the timestamps the note carried rather than take today's.
pub fn insert(connection: &Connection, task: &Task) -> AppResult<Task> {
    connection.execute(
        "INSERT INTO tasks
           (id, title, notes, done_at, due_date, due_time, priority, repeat_rule,
            created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            task.id,
            task.title,
            task.notes,
            task.done_at,
            task.due_date,
            task.due_time,
            task.priority.map(Priority::as_str),
            task.repeat.map(Repeat::as_str),
            task.created_at,
            task.updated_at,
        ],
    )?;
    Ok(task.clone())
}

/// Partial update. A field the patch does not mention is untouched; a nested
/// `Some(None)` clears it.
///
/// Clearing the due date clears the time with it: a time with no day is not a
/// when. A repeat with no due date is kept — it starts counting from the day the
/// task is first completed.
pub fn update(connection: &Connection, id: &str, patch: &TaskPatch, now: i64) -> AppResult<Task> {
    let existing = require(connection, id)?;

    let title = patch.title.clone().unwrap_or(existing.title);
    let notes = patch.notes.clone().unwrap_or(existing.notes);
    let due_date = patch.due_date.clone().unwrap_or(existing.due_date);
    let due_time = match (&due_date, patch.due_time.clone()) {
        (None, _) => None,
        (Some(_), Some(time)) => time,
        (Some(_), None) => existing.due_time,
    };
    let priority = patch.priority.unwrap_or(existing.priority);
    let repeat = patch.repeat.unwrap_or(existing.repeat);

    connection.execute(
        "UPDATE tasks
         SET title = ?2, notes = ?3, due_date = ?4, due_time = ?5, priority = ?6,
             repeat_rule = ?7, updated_at = ?8
         WHERE id = ?1 AND deleted_at IS NULL",
        params![
            id,
            title.trim(),
            notes,
            due_date,
            due_time,
            priority.map(Priority::as_str),
            repeat.map(Repeat::as_str),
            now,
        ],
    )?;
    require(connection, id)
}

/// Complete a task, or reopen it.
///
/// A repeating task is never completed here: the frontend works out its next
/// date — calendar months and local time are its job — and sends that through
/// `update` instead, which leaves the task open on a later day.
pub fn set_done(connection: &Connection, id: &str, done: bool, now: i64) -> AppResult<Task> {
    require(connection, id)?;
    connection.execute(
        "UPDATE tasks SET done_at = ?2, updated_at = ?3 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, done.then_some(now), now],
    )?;
    require(connection, id)
}

pub fn delete(connection: &Connection, id: &str, now: i64) -> AppResult<()> {
    let changed = connection.execute(
        "UPDATE tasks SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, now],
    )?;
    if changed == 0 {
        return Err(AppError::TaskNotFound(id.to_owned()));
    }
    Ok(())
}

/// Undo a delete. `updated_at` is deliberately left alone, as a note's restore
/// leaves it: an undone delete returns to where it was, not to the top.
pub fn restore(connection: &Connection, id: &str) -> AppResult<Task> {
    let changed = connection.execute(
        "UPDATE tasks SET deleted_at = NULL WHERE id = ?1 AND deleted_at IS NOT NULL",
        params![id],
    )?;
    if changed == 0 {
        return Err(AppError::TaskNotFound(id.to_owned()));
    }
    require(connection, id)
}

/// Drop tasks deleted longer ago than `PURGE_AFTER_MS`. Completed tasks are
/// never purged: finishing something is not a reason to lose the record of it.
pub fn purge_expired(connection: &Connection, now: i64) -> AppResult<usize> {
    Ok(connection.execute(
        "DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
        params![now - PURGE_AFTER_MS],
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    const NOW: i64 = 1_700_000_000_000;

    fn db() -> Database {
        Database::in_memory().expect("in-memory database")
    }

    fn with_title(title: &str) -> TaskPatch {
        TaskPatch {
            title: Some(title.to_owned()),
            ..TaskPatch::default()
        }
    }

    #[test]
    fn creates_an_open_task_with_nothing_set() {
        let db = db();
        let task = db
            .with(|c| create(c, &with_title("Call the bank"), NOW))
            .expect("create");

        assert_eq!(task.title, "Call the bank");
        assert_eq!(task.notes, "");
        assert_eq!(task.done_at, None);
        assert_eq!(task.due_date, None);
        assert_eq!(task.priority, None);
        assert_eq!(task.repeat, None);
        assert_eq!(task.created_at, NOW);
    }

    #[test]
    fn lists_in_a_stable_order_and_leaves_out_deleted_tasks() {
        let db = db();
        let first = db
            .with(|c| create(c, &with_title("one"), NOW))
            .expect("one");
        let second = db
            .with(|c| create(c, &with_title("two"), NOW + 1))
            .expect("two");
        db.with(|c| create(c, &with_title("three"), NOW + 2))
            .expect("three");
        db.with(|c| delete(c, &second.id, NOW + 3)).expect("delete");

        let listed = db.with(list).expect("list");
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, first.id);
        assert_eq!(listed[1].title, "three");
    }

    #[test]
    fn updates_only_what_the_patch_mentions() {
        let db = db();
        let task = db
            .with(|c| {
                create(
                    c,
                    &TaskPatch {
                        title: Some("Pay rent".to_owned()),
                        due_date: Some(Some("2026-10-01".to_owned())),
                        priority: Some(Some(Priority::High)),
                        ..TaskPatch::default()
                    },
                    NOW,
                )
            })
            .expect("create");

        let updated = db
            .with(|c| {
                update(
                    c,
                    &task.id,
                    &TaskPatch {
                        notes: Some("account 1234".to_owned()),
                        ..TaskPatch::default()
                    },
                    NOW + 10,
                )
            })
            .expect("update");

        assert_eq!(updated.notes, "account 1234");
        assert_eq!(updated.title, "Pay rent");
        assert_eq!(updated.due_date.as_deref(), Some("2026-10-01"));
        assert_eq!(updated.priority, Some(Priority::High));
        assert_eq!(updated.updated_at, NOW + 10);
    }

    #[test]
    fn clears_a_field_asked_to_be_cleared() {
        let db = db();
        let task = db
            .with(|c| {
                create(
                    c,
                    &TaskPatch {
                        title: Some("Stand-up".to_owned()),
                        due_date: Some(Some("2026-09-20".to_owned())),
                        due_time: Some(Some("09:30".to_owned())),
                        priority: Some(Some(Priority::Low)),
                        ..TaskPatch::default()
                    },
                    NOW,
                )
            })
            .expect("create");

        let updated = db
            .with(|c| {
                update(
                    c,
                    &task.id,
                    &TaskPatch {
                        priority: Some(None),
                        ..TaskPatch::default()
                    },
                    NOW + 1,
                )
            })
            .expect("update");
        assert_eq!(updated.priority, None);
        assert_eq!(updated.due_time.as_deref(), Some("09:30"));
    }

    /// A time with no day is not a when.
    #[test]
    fn clearing_the_due_date_clears_the_time_with_it() {
        let db = db();
        let task = db
            .with(|c| {
                create(
                    c,
                    &TaskPatch {
                        title: Some("Stand-up".to_owned()),
                        due_date: Some(Some("2026-09-20".to_owned())),
                        due_time: Some(Some("09:30".to_owned())),
                        ..TaskPatch::default()
                    },
                    NOW,
                )
            })
            .expect("create");

        let updated = db
            .with(|c| {
                update(
                    c,
                    &task.id,
                    &TaskPatch {
                        due_date: Some(None),
                        ..TaskPatch::default()
                    },
                    NOW + 1,
                )
            })
            .expect("update");
        assert_eq!(updated.due_date, None);
        assert_eq!(updated.due_time, None);
    }

    #[test]
    fn completing_records_when_and_reopening_clears_it() {
        let db = db();
        let task = db
            .with(|c| create(c, &with_title("Ship it"), NOW))
            .expect("create");

        let done = db
            .with(|c| set_done(c, &task.id, true, NOW + 5))
            .expect("done");
        assert_eq!(done.done_at, Some(NOW + 5));

        let open = db
            .with(|c| set_done(c, &task.id, false, NOW + 6))
            .expect("reopen");
        assert_eq!(open.done_at, None);
    }

    #[test]
    fn a_deleted_task_can_be_restored_where_it_was() {
        let db = db();
        let task = db
            .with(|c| create(c, &with_title("Oops"), NOW))
            .expect("create");
        db.with(|c| update(c, &task.id, &with_title("Oops"), NOW + 5))
            .expect("update");
        db.with(|c| delete(c, &task.id, NOW + 10)).expect("delete");
        assert!(db.with(list).expect("list").is_empty());

        let restored = db.with(|c| restore(c, &task.id)).expect("restore");
        assert_eq!(restored.title, "Oops");
        // Restoring does not move it to the top.
        assert_eq!(restored.updated_at, NOW + 10);
        assert_eq!(db.with(list).expect("list").len(), 1);
    }

    #[test]
    fn a_missing_task_is_an_error_rather_than_a_silent_no_op() {
        let db = db();
        assert!(db.with(|c| set_done(c, "nope", true, NOW)).is_err());
        assert!(db.with(|c| delete(c, "nope", NOW)).is_err());
        assert!(db.with(|c| restore(c, "nope")).is_err());
    }

    #[test]
    fn purges_old_deletions_but_never_completed_tasks() {
        let db = db();
        let old = db
            .with(|c| create(c, &with_title("old"), NOW))
            .expect("old");
        let recent = db
            .with(|c| create(c, &with_title("recent"), NOW))
            .expect("recent");
        let finished = db
            .with(|c| create(c, &with_title("finished"), NOW))
            .expect("finished");

        db.with(|c| delete(c, &old.id, NOW)).expect("delete old");
        db.with(|c| delete(c, &recent.id, NOW + PURGE_AFTER_MS))
            .expect("delete recent");
        db.with(|c| set_done(c, &finished.id, true, NOW))
            .expect("finish");

        let purged = db
            .with(|c| purge_expired(c, NOW + PURGE_AFTER_MS + 1))
            .expect("purge");
        assert_eq!(purged, 1);
        assert!(db.with(|c| get(c, &old.id)).expect("get").is_none());
        assert!(db.with(|c| get(c, &recent.id)).expect("get").is_some());
        assert!(db.with(|c| get(c, &finished.id)).expect("get").is_some());
    }

    #[test]
    fn trims_a_title_so_a_stray_space_never_reaches_the_list() {
        let db = db();
        let task = db
            .with(|c| create(c, &with_title("  padded  "), NOW))
            .expect("create");
        let updated = db
            .with(|c| update(c, &task.id, &with_title("  padded  "), NOW + 1))
            .expect("update");
        assert_eq!(updated.title, "padded");
    }
}
