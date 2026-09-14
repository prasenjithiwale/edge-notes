//! Notes storage. Deletes are soft (brief 9.1) so undo works now and a sync
//! engine can reconcile tombstones later.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// Palette ids from brief 7.3. Only the id is stored, never a hex value, so the
/// palette can be retuned without touching the database.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteColor {
    Yellow,
    Peach,
    Pink,
    Lavender,
    Blue,
    Mint,
    Gray,
}

impl NoteColor {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Yellow => "yellow",
            Self::Peach => "peach",
            Self::Pink => "pink",
            Self::Lavender => "lavender",
            Self::Blue => "blue",
            Self::Mint => "mint",
            Self::Gray => "gray",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "yellow" => Ok(Self::Yellow),
            "peach" => Ok(Self::Peach),
            "pink" => Ok(Self::Pink),
            "lavender" => Ok(Self::Lavender),
            "blue" => Ok(Self::Blue),
            "mint" => Ok(Self::Mint),
            "gray" => Ok(Self::Gray),
            other => Err(AppError::UnknownColor(other.to_owned())),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub content: String,
    pub color: NoteColor,
    /// Pinned notes sort above the rest and are read-only until the edit button
    /// on the card is used.
    pub pinned: bool,
    /// Unix milliseconds.
    pub created_at: i64,
    pub updated_at: i64,
}

/// Notes soft-deleted longer ago than this are purged at startup (brief 9.1).
pub const PURGE_AFTER_MS: i64 = 30 * 24 * 60 * 60 * 1000;

const SELECT_COLUMNS: &str = "id, content, color, pinned, created_at, updated_at";

type Row = (String, String, String, bool, i64, i64);

fn row_to_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<Row> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
    ))
}

fn build(raw: Row) -> AppResult<Note> {
    Ok(Note {
        id: raw.0,
        content: raw.1,
        color: NoteColor::parse(&raw.2)?,
        pinned: raw.3,
        created_at: raw.4,
        updated_at: raw.5,
    })
}

/// Active notes: pinned first, then most recently edited (brief 6.8, and the
/// `pinned` column brief 9.1 reserved for exactly this).
pub fn list(connection: &Connection) -> AppResult<Vec<Note>> {
    let sql = format!(
        "SELECT {SELECT_COLUMNS} FROM notes WHERE deleted_at IS NULL
         ORDER BY pinned DESC, updated_at DESC, id DESC"
    );
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map([], row_to_note)?;

    let mut notes = Vec::new();
    for row in rows {
        notes.push(build(row?)?);
    }
    Ok(notes)
}

pub fn get(connection: &Connection, id: &str) -> AppResult<Option<Note>> {
    let sql = format!("SELECT {SELECT_COLUMNS} FROM notes WHERE id = ?1");
    let raw = connection
        .query_row(&sql, params![id], row_to_note)
        .optional()?;
    raw.map(build).transpose()
}

/// Create an empty note. Ids are UUID v7: time-ordered, so they sort naturally
/// and stay sync-friendly.
pub fn create(connection: &Connection, color: NoteColor, now: i64) -> AppResult<Note> {
    let note = Note {
        id: uuid::Uuid::now_v7().to_string(),
        content: String::new(),
        color,
        // A new note is never pinned: it is empty, and it belongs at the top of
        // the unpinned notes where the editor just opened it.
        pinned: false,
        created_at: now,
        updated_at: now,
    };
    connection.execute(
        "INSERT INTO notes (id, content, color, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            note.id,
            note.content,
            note.color.as_str(),
            note.created_at,
            note.updated_at
        ],
    )?;
    Ok(note)
}

/// Partial update; any field left as `None` is untouched. Always bumps
/// `updated_at`, which is what re-sorts the list.
pub fn update(
    connection: &Connection,
    id: &str,
    content: Option<&str>,
    color: Option<NoteColor>,
    now: i64,
) -> AppResult<Note> {
    let existing = get(connection, id)?.ok_or_else(|| AppError::NoteNotFound(id.to_owned()))?;
    let content = content.unwrap_or(&existing.content);
    let color = color.unwrap_or(existing.color);

    connection.execute(
        "UPDATE notes SET content = ?2, color = ?3, updated_at = ?4
         WHERE id = ?1 AND deleted_at IS NULL",
        params![id, content, color.as_str(), now],
    )?;

    get(connection, id)?.ok_or_else(|| AppError::NoteNotFound(id.to_owned()))
}

/// Pin or unpin.
///
/// `updated_at` is deliberately left alone, for the same reason restore leaves
/// it: pinning is not an edit, and bumping it would reorder the list underneath
/// everything else that was pinned.
pub fn set_pinned(connection: &Connection, id: &str, pinned: bool) -> AppResult<Note> {
    let changed = connection.execute(
        "UPDATE notes SET pinned = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, pinned],
    )?;
    if changed == 0 {
        return Err(AppError::NoteNotFound(id.to_owned()));
    }
    get(connection, id)?.ok_or_else(|| AppError::NoteNotFound(id.to_owned()))
}

/// Soft delete: the row stays so undo is instant and sync can see the tombstone.
pub fn delete(connection: &Connection, id: &str, now: i64) -> AppResult<()> {
    let changed = connection.execute(
        "UPDATE notes SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, now],
    )?;
    if changed == 0 {
        return Err(AppError::NoteNotFound(id.to_owned()));
    }
    Ok(())
}

/// Undo a delete. `updated_at` is left alone so the note returns to its old
/// position in the list rather than jumping to the top.
pub fn restore(connection: &Connection, id: &str) -> AppResult<Note> {
    let changed = connection.execute(
        "UPDATE notes SET deleted_at = NULL WHERE id = ?1 AND deleted_at IS NOT NULL",
        params![id],
    )?;
    if changed == 0 {
        return Err(AppError::NoteNotFound(id.to_owned()));
    }
    get(connection, id)?.ok_or_else(|| AppError::NoteNotFound(id.to_owned()))
}

/// Permanently remove notes soft-deleted more than 30 days ago. Returns the count.
pub fn purge_expired(connection: &Connection, now: i64) -> AppResult<usize> {
    let cutoff = now - PURGE_AFTER_MS;
    Ok(connection.execute(
        "DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
        params![cutoff],
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    const T0: i64 = 1_760_000_000_000;

    fn db() -> Connection {
        let mut connection = Connection::open_in_memory().expect("in-memory database");
        migrations::run(&mut connection).expect("migrate");
        connection
    }

    #[test]
    fn a_new_note_is_not_pinned() {
        let c = db();
        let note = create(&c, NoteColor::Yellow, T0).expect("create");
        assert!(!note.pinned);
    }

    #[test]
    fn pinned_notes_sort_above_more_recently_edited_ones() {
        let c = db();
        let old = create(&c, NoteColor::Yellow, T0).expect("create");
        let recent = create(&c, NoteColor::Blue, T0 + 5_000).expect("create");
        update(&c, &recent.id, Some("newest"), None, T0 + 9_000).expect("update");

        set_pinned(&c, &old.id, true).expect("pin");

        let listed = list(&c).expect("list");
        assert_eq!(listed[0].id, old.id, "the pinned note should lead");
        assert_eq!(listed[1].id, recent.id);
    }

    #[test]
    fn pinning_does_not_count_as_an_edit() {
        // Same reasoning as restore: bumping updated_at would reorder the note
        // against everything else that is pinned.
        let c = db();
        let note = create(&c, NoteColor::Yellow, T0).expect("create");

        let pinned = set_pinned(&c, &note.id, true).expect("pin");
        assert!(pinned.pinned);
        assert_eq!(pinned.updated_at, note.updated_at);

        let unpinned = set_pinned(&c, &note.id, false).expect("unpin");
        assert!(!unpinned.pinned);
        assert_eq!(unpinned.updated_at, note.updated_at);
    }

    #[test]
    fn pinning_survives_an_edit() {
        let c = db();
        let note = create(&c, NoteColor::Yellow, T0).expect("create");
        set_pinned(&c, &note.id, true).expect("pin");

        let edited = update(&c, &note.id, Some("changed"), None, T0 + 1_000).expect("update");
        assert!(edited.pinned, "editing a pinned note must not unpin it");
    }

    #[test]
    fn a_missing_or_deleted_note_cannot_be_pinned() {
        let c = db();
        assert!(set_pinned(&c, "nope", true).is_err());

        let note = create(&c, NoteColor::Yellow, T0).expect("create");
        delete(&c, &note.id, T0 + 1_000).expect("delete");
        assert!(set_pinned(&c, &note.id, true).is_err());
    }

    #[test]
    fn creates_an_empty_note_with_a_time_ordered_id() {
        let connection = db();
        let note = create(&connection, NoteColor::Yellow, T0).expect("create");

        assert_eq!(note.content, "");
        assert_eq!(note.color, NoteColor::Yellow);
        assert_eq!(note.created_at, T0);
        assert_eq!(note.updated_at, T0);

        let parsed = uuid::Uuid::parse_str(&note.id).expect("valid uuid");
        assert_eq!(parsed.get_version_num(), 7);
    }

    #[test]
    fn lists_most_recently_edited_first() {
        let connection = db();
        let older = create(&connection, NoteColor::Blue, T0).expect("create");
        let newer = create(&connection, NoteColor::Mint, T0 + 1_000).expect("create");

        let listed = list(&connection).expect("list");
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, newer.id);
        assert_eq!(listed[1].id, older.id);
    }

    #[test]
    fn editing_moves_a_note_to_the_top() {
        let connection = db();
        let first = create(&connection, NoteColor::Blue, T0).expect("create");
        let _second = create(&connection, NoteColor::Mint, T0 + 1_000).expect("create");

        update(&connection, &first.id, Some("edited"), None, T0 + 2_000).expect("update");

        let listed = list(&connection).expect("list");
        assert_eq!(listed[0].id, first.id);
        assert_eq!(listed[0].content, "edited");
    }

    #[test]
    fn update_is_partial() {
        let connection = db();
        let note = create(&connection, NoteColor::Yellow, T0).expect("create");

        let content_only =
            update(&connection, &note.id, Some("hello"), None, T0 + 1).expect("content");
        assert_eq!(content_only.content, "hello");
        assert_eq!(content_only.color, NoteColor::Yellow);

        let colour_only =
            update(&connection, &note.id, None, Some(NoteColor::Pink), T0 + 2).expect("colour");
        assert_eq!(colour_only.content, "hello");
        assert_eq!(colour_only.color, NoteColor::Pink);
    }

    #[test]
    fn update_bumps_updated_at_but_not_created_at() {
        let connection = db();
        let note = create(&connection, NoteColor::Yellow, T0).expect("create");
        let updated = update(&connection, &note.id, Some("x"), None, T0 + 5_000).expect("update");

        assert_eq!(updated.created_at, T0);
        assert_eq!(updated.updated_at, T0 + 5_000);
    }

    #[test]
    fn soft_delete_hides_the_note_but_keeps_the_row() {
        let connection = db();
        let note = create(&connection, NoteColor::Gray, T0).expect("create");
        delete(&connection, &note.id, T0 + 1_000).expect("delete");

        assert!(list(&connection).expect("list").is_empty());

        let rows: i64 = connection
            .query_row("SELECT count(*) FROM notes", [], |row| row.get(0))
            .expect("count");
        assert_eq!(rows, 1);
    }

    #[test]
    fn restore_brings_a_note_back_in_place() {
        let connection = db();
        let first = create(&connection, NoteColor::Blue, T0).expect("create");
        let _second = create(&connection, NoteColor::Mint, T0 + 1_000).expect("create");

        delete(&connection, &first.id, T0 + 2_000).expect("delete");
        let restored = restore(&connection, &first.id).expect("restore");

        // updated_at is untouched, so it returns below the newer note.
        assert_eq!(restored.updated_at, T0);
        let listed = list(&connection).expect("list");
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[1].id, first.id);
    }

    #[test]
    fn deleting_twice_reports_the_note_is_gone() {
        let connection = db();
        let note = create(&connection, NoteColor::Gray, T0).expect("create");
        delete(&connection, &note.id, T0 + 1).expect("first");

        let error = delete(&connection, &note.id, T0 + 2).expect_err("second");
        assert_eq!(error.code(), "note_not_found");
    }

    #[test]
    fn restoring_a_live_note_is_an_error() {
        let connection = db();
        let note = create(&connection, NoteColor::Gray, T0).expect("create");
        let error = restore(&connection, &note.id).expect_err("restore");
        assert_eq!(error.code(), "note_not_found");
    }

    #[test]
    fn updating_a_deleted_note_does_not_resurrect_it() {
        let connection = db();
        let note = create(&connection, NoteColor::Gray, T0).expect("create");
        delete(&connection, &note.id, T0 + 1).expect("delete");

        update(&connection, &note.id, Some("ghost"), None, T0 + 2).expect("update returns the row");
        assert!(list(&connection).expect("list").is_empty());
    }

    #[test]
    fn purges_only_notes_deleted_more_than_thirty_days_ago() {
        let connection = db();
        let old = create(&connection, NoteColor::Blue, T0).expect("create");
        let recent = create(&connection, NoteColor::Mint, T0).expect("create");
        let live = create(&connection, NoteColor::Pink, T0).expect("create");

        let now = T0 + PURGE_AFTER_MS * 2;
        delete(&connection, &old.id, now - PURGE_AFTER_MS - 1).expect("delete old");
        delete(&connection, &recent.id, now - 1_000).expect("delete recent");

        let purged = purge_expired(&connection, now).expect("purge");
        assert_eq!(purged, 1);

        assert!(get(&connection, &old.id).expect("get").is_none());
        assert!(get(&connection, &recent.id).expect("get").is_some());
        assert!(get(&connection, &live.id).expect("get").is_some());
    }

    #[test]
    fn purge_keeps_a_note_deleted_exactly_at_the_cutoff() {
        let connection = db();
        let note = create(&connection, NoteColor::Blue, T0).expect("create");
        let now = T0 + PURGE_AFTER_MS * 2;
        delete(&connection, &note.id, now - PURGE_AFTER_MS).expect("delete");

        assert_eq!(purge_expired(&connection, now).expect("purge"), 0);
    }

    #[test]
    fn every_palette_colour_round_trips() {
        let connection = db();
        for color in [
            NoteColor::Yellow,
            NoteColor::Peach,
            NoteColor::Pink,
            NoteColor::Lavender,
            NoteColor::Blue,
            NoteColor::Mint,
            NoteColor::Gray,
        ] {
            let note = create(&connection, color, T0).expect("create");
            let read = get(&connection, &note.id).expect("get").expect("present");
            assert_eq!(read.color, color);
        }
    }

    #[test]
    fn an_unknown_colour_in_the_database_is_reported() {
        let connection = db();
        connection
            .execute(
                "INSERT INTO notes (id, content, color, created_at, updated_at)
                 VALUES ('x', '', 'chartreuse', 1, 1)",
                [],
            )
            .expect("insert");

        let error = list(&connection).expect_err("list");
        assert_eq!(error.code(), "unknown_color");
    }
}
