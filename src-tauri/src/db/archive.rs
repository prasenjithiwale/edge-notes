//! What has been deleted and can still be brought back.
//!
//! Notes and tasks are soft-deleted (brief 9.1): the row stays, with a
//! `deleted_at`, and is purged thirty days later. That was already true — undo
//! and a future sync engine both need it — but nothing could *see* it, so a
//! delete whose toast had gone was indistinguishable from a delete that was
//! final. This is the list that was missing.
//!
//! One list rather than one per kind: the question it answers is "where did the
//! thing I just deleted go", and the answer is ordered by when, not by what.
//! Each row carries just enough to recognise the thing — a note's text, a task's
//! title — because restoring is what happens next, and everything else about it
//! comes back with it.

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

use super::notes::PURGE_AFTER_MS;

/// The kind of thing that was deleted. Serialised as `"note"` or `"task"`, which
/// is what the frontend switches on to know which restore command to send.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArchivedKind {
    Note,
    Task,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedItem {
    pub id: String,
    pub kind: ArchivedKind,
    /// A note's whole content, or a task's title: the frontend already knows how
    /// to make a heading and a preview out of a note, and asking it to do that
    /// here keeps one answer to "what does this note look like in a list".
    pub text: String,
    /// The note's palette id, so a card can be recognised by its colour. Tasks
    /// have none.
    pub color: Option<String>,
    pub deleted_at: i64,
    /// When this row is purged: `deleted_at` plus the thirty days brief 9.1
    /// gives it. Sent rather than worked out in the frontend, so the app and the
    /// startup purge cannot disagree about when something is gone for good.
    pub purge_at: i64,
}

/// Everything deleted and not yet purged, most recently deleted first.
pub fn list(connection: &Connection) -> AppResult<Vec<ArchivedItem>> {
    let mut items = Vec::new();

    {
        let mut statement = connection.prepare(
            "SELECT id, content, color, deleted_at FROM notes
             WHERE deleted_at IS NOT NULL",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(ArchivedItem {
                id: row.get(0)?,
                kind: ArchivedKind::Note,
                text: row.get(1)?,
                color: Some(row.get::<_, String>(2)?),
                deleted_at: row.get(3)?,
                purge_at: row.get::<_, i64>(3)? + PURGE_AFTER_MS,
            })
        })?;
        for row in rows {
            items.push(row?);
        }
    }

    {
        let mut statement = connection.prepare(
            "SELECT id, title, deleted_at FROM tasks
             WHERE deleted_at IS NOT NULL",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(ArchivedItem {
                id: row.get(0)?,
                kind: ArchivedKind::Task,
                text: row.get(1)?,
                color: None,
                deleted_at: row.get(2)?,
                purge_at: row.get::<_, i64>(2)? + PURGE_AFTER_MS,
            })
        })?;
        for row in rows {
            items.push(row?);
        }
    }

    // Newest first, and by id when two were deleted in the same millisecond, so
    // the list is stable between reads rather than shuffling on a redraw.
    items.sort_by(|a, b| {
        b.deleted_at
            .cmp(&a.deleted_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(items)
}

/// Delete one for good, before its thirty days are up.
///
/// The only hard delete in the app, and the only thing here that cannot be
/// undone — which is why it is guarded twice. `deleted_at IS NOT NULL` is the
/// binding half: this can reach a row that is already in the archive and nothing
/// else, so a bug in the id cannot take a live note with it. A row that is not
/// there is an error rather than a silent success, because the caller believed
/// it was deleting something.
pub fn purge_one(connection: &Connection, id: &str, kind: ArchivedKind) -> AppResult<()> {
    let sql = match kind {
        ArchivedKind::Note => "DELETE FROM notes WHERE id = ?1 AND deleted_at IS NOT NULL",
        ArchivedKind::Task => "DELETE FROM tasks WHERE id = ?1 AND deleted_at IS NOT NULL",
    };
    let deleted = connection.execute(sql, params![id])?;
    if deleted == 0 {
        return Err(match kind {
            ArchivedKind::Note => AppError::NoteNotFound(id.to_owned()),
            ArchivedKind::Task => AppError::TaskNotFound(id.to_owned()),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{Database, NoteColor, TaskPatch, notes, tasks};

    const NOW: i64 = 1_700_000_000_000;

    fn db() -> Database {
        Database::in_memory().expect("in-memory database")
    }

    #[test]
    fn lists_nothing_while_nothing_has_been_deleted() {
        let db = db();
        db.with(|c| notes::create(c, NoteColor::Yellow, NOW))
            .expect("note");
        assert!(db.with(list).expect("list").is_empty());
    }

    #[test]
    fn lists_deleted_notes_and_tasks_together_newest_first() {
        let db = db();
        let note = db
            .with(|c| notes::create(c, NoteColor::Blue, NOW))
            .expect("note");
        db.with(|c| notes::update(c, &note.id, Some("Milk and coffee"), None, NOW))
            .expect("write");
        let task = db
            .with(|c| {
                tasks::create(
                    c,
                    &TaskPatch {
                        title: Some("Call the bank".to_owned()),
                        ..TaskPatch::default()
                    },
                    NOW,
                )
            })
            .expect("task");

        db.with(|c| notes::delete(c, &note.id, NOW + 10))
            .expect("delete note");
        db.with(|c| tasks::delete(c, &task.id, NOW + 20))
            .expect("delete task");

        let items = db.with(list).expect("list");
        assert_eq!(items.len(), 2);
        // The task went second, so it is first.
        assert_eq!(items[0].kind, ArchivedKind::Task);
        assert_eq!(items[0].text, "Call the bank");
        assert_eq!(items[0].color, None);
        assert_eq!(items[0].deleted_at, NOW + 20);
        assert_eq!(items[0].purge_at, NOW + 20 + PURGE_AFTER_MS);

        assert_eq!(items[1].kind, ArchivedKind::Note);
        assert_eq!(items[1].text, "Milk and coffee");
        assert_eq!(items[1].color.as_deref(), Some("blue"));
    }

    #[test]
    fn purging_one_takes_it_out_for_good() {
        let db = db();
        let note = db
            .with(|c| notes::create(c, NoteColor::Sand, NOW))
            .expect("note");
        db.with(|c| notes::delete(c, &note.id, NOW + 1))
            .expect("delete");

        db.with(|c| purge_one(c, &note.id, ArchivedKind::Note))
            .expect("purge");

        assert!(db.with(list).expect("list").is_empty());
        assert!(db.with(|c| notes::get(c, &note.id)).expect("get").is_none());
        // And it cannot be restored, because there is nothing to restore.
        assert!(db.with(|c| notes::restore(c, &note.id)).is_err());
    }

    /// The guard that matters: this is the one irreversible thing in the app, so
    /// it must not be able to reach a note somebody is still using.
    #[test]
    fn will_not_touch_a_note_that_is_not_in_the_archive() {
        let db = db();
        let note = db
            .with(|c| notes::create(c, NoteColor::Sky, NOW))
            .expect("note");

        assert!(
            db.with(|c| purge_one(c, &note.id, ArchivedKind::Note))
                .is_err()
        );
        assert!(db.with(|c| notes::get(c, &note.id)).expect("get").is_some());
    }

    #[test]
    fn purges_a_task_from_the_tasks_table() {
        let db = db();
        let task = db
            .with(|c| {
                tasks::create(
                    c,
                    &TaskPatch {
                        title: Some("Call the bank".to_owned()),
                        ..TaskPatch::default()
                    },
                    NOW,
                )
            })
            .expect("task");
        db.with(|c| tasks::delete(c, &task.id, NOW + 1))
            .expect("delete");

        db.with(|c| purge_one(c, &task.id, ArchivedKind::Task))
            .expect("purge");
        assert!(db.with(|c| tasks::get(c, &task.id)).expect("get").is_none());
    }

    #[test]
    fn a_restored_note_leaves_the_list() {
        let db = db();
        let note = db
            .with(|c| notes::create(c, NoteColor::Mint, NOW))
            .expect("note");
        db.with(|c| notes::delete(c, &note.id, NOW + 1))
            .expect("delete");
        assert_eq!(db.with(list).expect("list").len(), 1);

        db.with(|c| notes::restore(c, &note.id)).expect("restore");
        assert!(db.with(list).expect("list").is_empty());
    }
}
