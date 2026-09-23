//! Settings storage: one key/value row per setting, values as JSON (brief 9.1).
//!
//! The struct field names carry the dotted storage keys, so the wire format, the
//! table contents and the defaults table in brief 9.2 all stay in step.

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use crate::db::notes::NoteColor;
use crate::dock::{OpenTrigger, Side};
use crate::error::AppResult;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    System,
    Light,
    Dark,
}

/// How the collapsed tab is painted (`tab.appearance`). Translucent lets what is
/// underneath show through the tab while it waits at the edge; the tab turns
/// solid while the panel is out, to match the panel it is attached to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TabAppearance {
    Translucent,
    Solid,
}

/// How big the collapsed tab is drawn, and how big its window is.
///
/// A scale rather than a pixel size: the tab is a window, a hit area and a
/// painted pill, and all three have to move together. One factor keeps them in
/// proportion and keeps the choice to something a person can make.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TabSize {
    Small,
    Medium,
    Large,
}

impl TabSize {
    /// What the default metrics are multiplied by. The frontend paints the pill
    /// from the same three numbers (`applyTabSize`); they are written down in
    /// both places because the window is Rust's and the paint is CSS's.
    #[must_use]
    pub fn scale(self) -> f64 {
        match self {
            Self::Small => 0.8,
            Self::Medium => 1.0,
            Self::Large => 1.4,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Settings {
    #[serde(rename = "dock.side")]
    pub dock_side: Side,
    #[serde(rename = "dock.monitor")]
    pub dock_monitor: String,
    #[serde(rename = "dock.tabOffset")]
    pub dock_tab_offset: f64,
    #[serde(rename = "dock.openDelayMs")]
    pub dock_open_delay_ms: u64,
    #[serde(rename = "dock.closeDelayMs")]
    pub dock_close_delay_ms: u64,
    #[serde(rename = "dock.openOn")]
    pub dock_open_on: OpenTrigger,
    #[serde(rename = "tab.appearance")]
    pub tab_appearance: TabAppearance,
    /// Not in brief 9.2: how big the collapsed tab is (owner's request).
    #[serde(rename = "tab.size")]
    pub tab_size: TabSize,
    #[serde(rename = "panel.width")]
    pub panel_width: f64,
    #[serde(rename = "theme")]
    pub theme: Theme,
    #[serde(rename = "notes.lastColor")]
    pub notes_last_color: NoteColor,
    /// The language written after the last code fence the editor inserted, so
    /// the next one starts there. Free text: the frontend owns the list, and a
    /// language it does not know is still what the author called it. Empty means
    /// a fence with no language.
    #[serde(rename = "notes.lastCodeLang")]
    pub notes_last_code_lang: String,
    /// Not in brief 9.2: a colour for the panel's own chrome, from the note
    /// palette. `None` is the neutral chrome brief 7.1 asks for, and the
    /// default; anything else tints the header, the toolbar and the focus ring,
    /// which the owner asked for on 23 Sep 2026.
    #[serde(rename = "appearance.accent")]
    pub appearance_accent: NoteColor,
    /// Not in brief 9.2: the notes list is in the order the cards were dragged
    /// into, rather than most recently edited first (idea 16).
    #[serde(rename = "notes.manualOrder")]
    pub notes_manual_order: bool,
    #[serde(rename = "shortcut.newNote")]
    pub shortcut_new_note: String,
    /// Not in brief 9.2: quick capture, and a note from the clipboard (brief 14).
    /// Empty means the shortcut is not bound at all, which is how someone turns
    /// one off without giving it a combination they will never press.
    #[serde(rename = "shortcut.quickCapture")]
    pub shortcut_quick_capture: String,
    #[serde(rename = "shortcut.clipboardNote")]
    pub shortcut_clipboard_note: String,
    /// Not in brief 9.2: a system notification when a task is due.
    #[serde(rename = "tasks.reminders")]
    pub tasks_reminders: bool,
    /// Keep the panel out of screen shares, recordings and screenshots.
    ///
    /// On by default: a widget that slides out on hover is easy to open by
    /// accident while presenting, and what it slides out is exactly the sort of
    /// thing nobody meant to show. Turning it off is a deliberate act.
    #[serde(rename = "privacy.hideFromCapture")]
    pub privacy_hide_from_capture: bool,
    /// Not in brief 9.2: how see-through the panel's surface is, as a percentage
    /// from 0 (solid, the brief's default) to `MAX_PANEL_TRANSLUCENCY`.
    #[serde(rename = "panel.translucency")]
    pub panel_translucency: u8,
    /// The Focus tab's phase lengths, in minutes, and how many focus sessions
    /// earn the long break. Not in brief 9.2: the Focus tab came later, and its
    /// lengths were fixed constants until now.
    #[serde(rename = "focus.focusMinutes")]
    pub focus_focus_minutes: u16,
    #[serde(rename = "focus.breakMinutes")]
    pub focus_break_minutes: u16,
    #[serde(rename = "focus.longBreakMinutes")]
    pub focus_long_break_minutes: u16,
    #[serde(rename = "focus.longBreakEvery")]
    pub focus_long_break_every: u8,
    /// Start the next phase by itself when one ends. Off by default: a widget
    /// that starts counting at you without being asked is a nag.
    #[serde(rename = "focus.autoStart")]
    pub focus_auto_start: bool,
    /// The Focus tab's own state rather than a preference, kept here because the
    /// settings table is the app's key/value store and a counter that survives a
    /// restart does not deserve a table of its own. Empty means none.
    #[serde(rename = "focus.taskId")]
    pub focus_task_id: String,
    /// Local `YYYY-MM-DD` the tally below belongs to; it resets when the day does.
    #[serde(rename = "focus.day")]
    pub focus_day: String,
    #[serde(rename = "focus.today")]
    pub focus_today: u32,
    /// Focus sessions finished since the last long break.
    #[serde(rename = "focus.streak")]
    pub focus_streak: u32,
}

/// What a phase length may be set to, in minutes. One minute is a legitimate
/// test of the notification; past two hours it is not a pomodoro.
pub const FOCUS_MINUTES: std::ops::RangeInclusive<u16> = 1..=120;

/// How many focus sessions may be asked for before the long break.
pub const LONG_BREAK_EVERY: std::ops::RangeInclusive<u8> = 2..=8;

/// Past this the notes on a busy desktop stop being readable: the panel has no
/// blur behind it, only transparency.
pub const MAX_PANEL_TRANSLUCENCY: u8 = 60;

impl Settings {
    /// The placement half of the settings, for the dock (brief 9.2).
    pub fn placement(&self) -> crate::dock::Placement {
        crate::dock::Placement {
            side: self.dock_side,
            tab_offset: self.dock_tab_offset,
            panel_width: self.panel_width,
            tab_scale: self.tab_size.scale(),
            monitor: self.dock_monitor.clone(),
        }
    }

    /// The two hover delays and what opens the panel, which apply without a
    /// restart (brief 9.3).
    pub fn timings(&self) -> crate::dock::Timings {
        crate::dock::Timings {
            open_trigger: self.dock_open_on,
            open_delay: std::time::Duration::from_millis(self.dock_open_delay_ms),
            close_delay: std::time::Duration::from_millis(self.dock_close_delay_ms),
            ..crate::dock::Timings::default()
        }
    }
}

impl Default for Settings {
    /// Brief 9.2.
    fn default() -> Self {
        Self {
            dock_side: Side::Right,
            dock_monitor: "primary".to_owned(),
            dock_tab_offset: 0.5,
            dock_open_delay_ms: 120,
            dock_close_delay_ms: 400,
            // Not in brief 9.2; hover is what brief 6.1 specifies.
            dock_open_on: OpenTrigger::Hover,
            // Not in brief 9.2; asked for by the owner.
            tab_appearance: TabAppearance::Translucent,
            tab_size: TabSize::Medium,
            panel_width: 320.0,
            theme: Theme::System,
            notes_last_color: NoteColor::Yellow,
            notes_last_code_lang: String::new(),
            // Recency until something is dragged: the order a widget shows by
            // default should be the one nobody had to arrange.
            // Neutral until someone chooses otherwise: brief 7.1's chrome.
            appearance_accent: NoteColor::None,
            notes_manual_order: false,
            shortcut_new_note: "CmdOrCtrl+Alt+N".to_owned(),
            // Beside the new-note one. Not ⌥⌘Space: that is macOS's own Finder
            // search, and the system takes it first, so the default would be a
            // shortcut that silently does nothing.
            shortcut_quick_capture: "CmdOrCtrl+Alt+Q".to_owned(),
            // Deliberately unbound: every ⌥⌘key that reads as "clipboard" (V, C)
            // is one Finder already uses, and taking it globally would break it
            // everywhere. Quick capture plus ⌘V does the same thing, so this is
            // a convenience to bind rather than one to take by default.
            shortcut_clipboard_note: String::new(),
            // Both asked for by the owner.
            tasks_reminders: true,
            privacy_hide_from_capture: true,
            panel_translucency: 0,
            // The classic lengths, which is what the Focus tab shipped with.
            focus_focus_minutes: 25,
            focus_break_minutes: 5,
            focus_long_break_minutes: 15,
            focus_long_break_every: 4,
            focus_auto_start: false,
            focus_task_id: String::new(),
            focus_day: String::new(),
            focus_today: 0,
            focus_streak: 0,
        }
    }
}

/// A partial update. Anything left `None` keeps its stored value.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct SettingsPatch {
    #[serde(rename = "dock.side")]
    pub dock_side: Option<Side>,
    #[serde(rename = "dock.monitor")]
    pub dock_monitor: Option<String>,
    #[serde(rename = "dock.tabOffset")]
    pub dock_tab_offset: Option<f64>,
    #[serde(rename = "dock.openDelayMs")]
    pub dock_open_delay_ms: Option<u64>,
    #[serde(rename = "dock.closeDelayMs")]
    pub dock_close_delay_ms: Option<u64>,
    #[serde(rename = "dock.openOn")]
    pub dock_open_on: Option<OpenTrigger>,
    #[serde(rename = "tab.appearance")]
    pub tab_appearance: Option<TabAppearance>,
    #[serde(rename = "tab.size")]
    pub tab_size: Option<TabSize>,
    #[serde(rename = "panel.width")]
    pub panel_width: Option<f64>,
    #[serde(rename = "theme")]
    pub theme: Option<Theme>,
    #[serde(rename = "notes.lastColor")]
    pub notes_last_color: Option<NoteColor>,
    #[serde(rename = "notes.lastCodeLang")]
    pub notes_last_code_lang: Option<String>,
    #[serde(rename = "appearance.accent")]
    pub appearance_accent: Option<NoteColor>,
    #[serde(rename = "notes.manualOrder")]
    pub notes_manual_order: Option<bool>,
    #[serde(rename = "shortcut.newNote")]
    pub shortcut_new_note: Option<String>,
    #[serde(rename = "shortcut.quickCapture")]
    pub shortcut_quick_capture: Option<String>,
    #[serde(rename = "shortcut.clipboardNote")]
    pub shortcut_clipboard_note: Option<String>,
    #[serde(rename = "tasks.reminders")]
    pub tasks_reminders: Option<bool>,
    #[serde(rename = "privacy.hideFromCapture")]
    pub privacy_hide_from_capture: Option<bool>,
    #[serde(rename = "panel.translucency")]
    pub panel_translucency: Option<u8>,
    #[serde(rename = "focus.focusMinutes")]
    pub focus_focus_minutes: Option<u16>,
    #[serde(rename = "focus.breakMinutes")]
    pub focus_break_minutes: Option<u16>,
    #[serde(rename = "focus.longBreakMinutes")]
    pub focus_long_break_minutes: Option<u16>,
    #[serde(rename = "focus.longBreakEvery")]
    pub focus_long_break_every: Option<u8>,
    #[serde(rename = "focus.autoStart")]
    pub focus_auto_start: Option<bool>,
    #[serde(rename = "focus.taskId")]
    pub focus_task_id: Option<String>,
    #[serde(rename = "focus.day")]
    pub focus_day: Option<String>,
    #[serde(rename = "focus.today")]
    pub focus_today: Option<u32>,
    #[serde(rename = "focus.streak")]
    pub focus_streak: Option<u32>,
}

/// Just the one flag the notes repository needs, so `list` can decide its own
/// ORDER BY without reading (and parsing) every setting on every load.
pub fn manual_order(connection: &Connection) -> AppResult<bool> {
    read(
        connection,
        "notes.manualOrder",
        Settings::default().notes_manual_order,
    )
}

fn read<T: for<'de> Deserialize<'de>>(
    connection: &Connection,
    key: &str,
    fallback: T,
) -> AppResult<T> {
    let stored: Option<String> = connection
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .ok();

    // A malformed or stale value falls back to the default rather than blocking
    // startup: settings are never worth failing the app over.
    Ok(stored
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or(fallback))
}

fn write<T: Serialize>(connection: &Connection, key: &str, value: &T) -> AppResult<()> {
    let encoded = serde_json::to_string(value)?;
    connection.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, encoded],
    )?;
    Ok(())
}

/// All settings, with defaults applied for anything unset (brief 9.3).
pub fn get(connection: &Connection) -> AppResult<Settings> {
    let defaults = Settings::default();
    Ok(Settings {
        dock_side: read(connection, "dock.side", defaults.dock_side)?,
        dock_monitor: read(connection, "dock.monitor", defaults.dock_monitor)?,
        dock_tab_offset: read(connection, "dock.tabOffset", defaults.dock_tab_offset)?,
        dock_open_delay_ms: read(connection, "dock.openDelayMs", defaults.dock_open_delay_ms)?,
        dock_close_delay_ms: read(
            connection,
            "dock.closeDelayMs",
            defaults.dock_close_delay_ms,
        )?,
        dock_open_on: read(connection, "dock.openOn", defaults.dock_open_on)?,
        tab_appearance: read(connection, "tab.appearance", defaults.tab_appearance)?,
        tab_size: read(connection, "tab.size", defaults.tab_size)?,
        panel_width: read(connection, "panel.width", defaults.panel_width)?,
        theme: read(connection, "theme", defaults.theme)?,
        notes_last_color: read(connection, "notes.lastColor", defaults.notes_last_color)?,
        notes_last_code_lang: read(
            connection,
            "notes.lastCodeLang",
            defaults.notes_last_code_lang,
        )?,
        appearance_accent: read(connection, "appearance.accent", defaults.appearance_accent)?,
        notes_manual_order: read(connection, "notes.manualOrder", defaults.notes_manual_order)?,
        shortcut_new_note: read(connection, "shortcut.newNote", defaults.shortcut_new_note)?,
        shortcut_quick_capture: read(
            connection,
            "shortcut.quickCapture",
            defaults.shortcut_quick_capture,
        )?,
        shortcut_clipboard_note: read(
            connection,
            "shortcut.clipboardNote",
            defaults.shortcut_clipboard_note,
        )?,
        tasks_reminders: read(connection, "tasks.reminders", defaults.tasks_reminders)?,
        privacy_hide_from_capture: read(
            connection,
            "privacy.hideFromCapture",
            defaults.privacy_hide_from_capture,
        )?,
        panel_translucency: read(
            connection,
            "panel.translucency",
            defaults.panel_translucency,
        )?
        .min(MAX_PANEL_TRANSLUCENCY),
        focus_focus_minutes: read(
            connection,
            "focus.focusMinutes",
            defaults.focus_focus_minutes,
        )?
        .clamp(*FOCUS_MINUTES.start(), *FOCUS_MINUTES.end()),
        focus_break_minutes: read(
            connection,
            "focus.breakMinutes",
            defaults.focus_break_minutes,
        )?
        .clamp(*FOCUS_MINUTES.start(), *FOCUS_MINUTES.end()),
        focus_long_break_minutes: read(
            connection,
            "focus.longBreakMinutes",
            defaults.focus_long_break_minutes,
        )?
        .clamp(*FOCUS_MINUTES.start(), *FOCUS_MINUTES.end()),
        focus_long_break_every: read(
            connection,
            "focus.longBreakEvery",
            defaults.focus_long_break_every,
        )?
        .clamp(*LONG_BREAK_EVERY.start(), *LONG_BREAK_EVERY.end()),
        focus_auto_start: read(connection, "focus.autoStart", defaults.focus_auto_start)?,
        focus_task_id: read(connection, "focus.taskId", defaults.focus_task_id)?,
        focus_day: read(connection, "focus.day", defaults.focus_day)?,
        focus_today: read(connection, "focus.today", defaults.focus_today)?,
        focus_streak: read(connection, "focus.streak", defaults.focus_streak)?,
    })
}

/// Apply a patch and return the full settings.
pub fn update(connection: &Connection, patch: &SettingsPatch) -> AppResult<Settings> {
    if let Some(value) = patch.dock_side {
        write(connection, "dock.side", &value)?;
    }
    if let Some(value) = &patch.dock_monitor {
        write(connection, "dock.monitor", value)?;
    }
    if let Some(value) = patch.dock_tab_offset {
        write(connection, "dock.tabOffset", &value.clamp(0.0, 1.0))?;
    }
    if let Some(value) = patch.dock_open_delay_ms {
        write(connection, "dock.openDelayMs", &value)?;
    }
    if let Some(value) = patch.dock_close_delay_ms {
        write(connection, "dock.closeDelayMs", &value)?;
    }
    if let Some(value) = patch.dock_open_on {
        write(connection, "dock.openOn", &value)?;
    }
    if let Some(value) = patch.tab_appearance {
        write(connection, "tab.appearance", &value)?;
    }
    if let Some(value) = patch.tab_size {
        write(connection, "tab.size", &value)?;
    }
    if let Some(value) = patch.panel_width {
        // Brief 6.4: configurable later within 280-420.
        write(connection, "panel.width", &value.clamp(280.0, 420.0))?;
    }
    if let Some(value) = patch.theme {
        write(connection, "theme", &value)?;
    }
    if let Some(value) = patch.notes_last_color {
        write(connection, "notes.lastColor", &value)?;
    }
    if let Some(value) = &patch.notes_last_code_lang {
        // A language name, not a sentence: anything longer is not one, and the
        // fence it would be written into has to stay a single line.
        write(
            connection,
            "notes.lastCodeLang",
            &value
                .chars()
                .take(32)
                .filter(|c| !c.is_whitespace())
                .collect::<String>(),
        )?;
    }
    if let Some(value) = patch.appearance_accent {
        write(connection, "appearance.accent", &value)?;
    }
    if let Some(value) = patch.notes_manual_order {
        write(connection, "notes.manualOrder", &value)?;
    }
    if let Some(value) = &patch.shortcut_new_note {
        write(connection, "shortcut.newNote", value)?;
    }
    if let Some(value) = &patch.shortcut_quick_capture {
        write(connection, "shortcut.quickCapture", value)?;
    }
    if let Some(value) = &patch.shortcut_clipboard_note {
        write(connection, "shortcut.clipboardNote", value)?;
    }
    if let Some(value) = patch.tasks_reminders {
        write(connection, "tasks.reminders", &value)?;
    }
    if let Some(value) = patch.privacy_hide_from_capture {
        write(connection, "privacy.hideFromCapture", &value)?;
    }
    if let Some(value) = patch.panel_translucency {
        write(
            connection,
            "panel.translucency",
            &value.min(MAX_PANEL_TRANSLUCENCY),
        )?;
    }
    for (key, minutes) in [
        ("focus.focusMinutes", patch.focus_focus_minutes),
        ("focus.breakMinutes", patch.focus_break_minutes),
        ("focus.longBreakMinutes", patch.focus_long_break_minutes),
    ] {
        if let Some(value) = minutes {
            write(
                connection,
                key,
                &value.clamp(*FOCUS_MINUTES.start(), *FOCUS_MINUTES.end()),
            )?;
        }
    }
    if let Some(value) = patch.focus_long_break_every {
        write(
            connection,
            "focus.longBreakEvery",
            &value.clamp(*LONG_BREAK_EVERY.start(), *LONG_BREAK_EVERY.end()),
        )?;
    }
    if let Some(value) = patch.focus_auto_start {
        write(connection, "focus.autoStart", &value)?;
    }
    if let Some(value) = &patch.focus_task_id {
        write(connection, "focus.taskId", value)?;
    }
    if let Some(value) = &patch.focus_day {
        write(connection, "focus.day", value)?;
    }
    if let Some(value) = patch.focus_today {
        write(connection, "focus.today", &value)?;
    }
    if let Some(value) = patch.focus_streak {
        write(connection, "focus.streak", &value)?;
    }
    get(connection)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn db() -> Connection {
        let mut connection = Connection::open_in_memory().expect("in-memory database");
        migrations::run(&mut connection).expect("migrate");
        connection
    }

    #[test]
    fn an_empty_database_returns_the_documented_defaults() {
        let connection = db();
        let settings = get(&connection).expect("get");
        assert_eq!(settings, Settings::default());
        assert_eq!(settings.dock_side, Side::Right);
        assert_eq!(settings.dock_tab_offset, 0.5);
        assert_eq!(settings.panel_width, 320.0);
        assert_eq!(settings.notes_last_color, NoteColor::Yellow);
        assert_eq!(settings.shortcut_new_note, "CmdOrCtrl+Alt+N");
        assert_eq!(settings.dock_open_on, OpenTrigger::Hover);
        assert!(settings.tasks_reminders);
        assert_eq!(settings.panel_translucency, 0);
        assert_eq!(settings.tab_appearance, TabAppearance::Translucent);
        assert_eq!(settings.tab_size, TabSize::Medium);
        assert_eq!(settings.placement().tab_scale, 1.0);
        assert_eq!(settings.focus_focus_minutes, 25);
        assert_eq!(settings.focus_break_minutes, 5);
        assert_eq!(settings.focus_long_break_minutes, 15);
        assert_eq!(settings.focus_long_break_every, 4);
        assert!(!settings.focus_auto_start);
        assert_eq!(settings.focus_today, 0);
        assert_eq!(settings.notes_last_code_lang, "");
    }

    /// It is written into a fence, which is one line: no whitespace, and short.
    #[test]
    fn the_last_code_language_is_kept_to_something_a_fence_can_hold() {
        let connection = db();
        let settings = update(
            &connection,
            &SettingsPatch {
                notes_last_code_lang: Some("python".to_owned()),
                ..SettingsPatch::default()
            },
        )
        .expect("update");
        assert_eq!(settings.notes_last_code_lang, "python");

        let settings = update(
            &connection,
            &SettingsPatch {
                notes_last_code_lang: Some("not a language\nat all".to_owned()),
                ..SettingsPatch::default()
            },
        )
        .expect("update");
        assert_eq!(settings.notes_last_code_lang, "notalanguageatall");
        assert_eq!(get(&connection).expect("get"), settings);
    }

    /// The tab is a window, a hit area and a painted pill; the scale is what
    /// keeps the three in proportion, so it has to reach the dock.
    #[test]
    fn the_tab_size_round_trips_and_reaches_the_dock() {
        let connection = db();
        let settings = update(
            &connection,
            &SettingsPatch {
                tab_size: Some(TabSize::Large),
                ..SettingsPatch::default()
            },
        )
        .expect("update");

        assert_eq!(settings.tab_size, TabSize::Large);
        assert!(settings.placement().tab_scale > 1.0);
        assert_eq!(get(&connection).expect("get"), settings);

        // Stored as the lowercase word the frontend sends.
        let raw: String = connection
            .query_row(
                "SELECT value FROM settings WHERE key = 'tab.size'",
                [],
                |row| row.get(0),
            )
            .expect("row");
        assert_eq!(raw, "\"large\"");
    }

    #[test]
    fn every_tab_size_is_a_different_scale_and_none_is_zero() {
        let scales: Vec<f64> = [TabSize::Small, TabSize::Medium, TabSize::Large]
            .into_iter()
            .map(TabSize::scale)
            .collect();
        assert!(scales.iter().all(|scale| *scale > 0.0));
        assert!(scales[0] < scales[1] && scales[1] < scales[2]);
    }

    #[test]
    fn focus_lengths_round_trip_and_are_clamped() {
        let connection = db();
        let settings = update(
            &connection,
            &SettingsPatch {
                focus_focus_minutes: Some(50),
                focus_break_minutes: Some(0),
                focus_long_break_minutes: Some(999),
                focus_long_break_every: Some(1),
                focus_auto_start: Some(true),
                ..SettingsPatch::default()
            },
        )
        .expect("update");

        assert_eq!(settings.focus_focus_minutes, 50);
        assert_eq!(settings.focus_break_minutes, *FOCUS_MINUTES.start());
        assert_eq!(settings.focus_long_break_minutes, *FOCUS_MINUTES.end());
        assert_eq!(settings.focus_long_break_every, *LONG_BREAK_EVERY.start());
        assert!(settings.focus_auto_start);
        assert_eq!(get(&connection).expect("get"), settings);
    }

    /// The day's tally is state rather than a preference, and it has to survive a
    /// restart, which is the whole reason it is stored at all.
    #[test]
    fn the_focus_tally_and_its_task_persist() {
        let connection = db();
        let settings = update(
            &connection,
            &SettingsPatch {
                focus_day: Some("2026-09-17".to_owned()),
                focus_today: Some(3),
                focus_streak: Some(3),
                focus_task_id: Some("0192-abc".to_owned()),
                ..SettingsPatch::default()
            },
        )
        .expect("update");

        assert_eq!(settings.focus_day, "2026-09-17");
        assert_eq!(settings.focus_today, 3);
        assert_eq!(settings.focus_streak, 3);
        assert_eq!(settings.focus_task_id, "0192-abc");
        assert_eq!(get(&connection).expect("get"), settings);
    }

    #[test]
    fn open_trigger_and_tab_appearance_round_trip_and_reach_the_dock() {
        let connection = db();
        let settings = update(
            &connection,
            &SettingsPatch {
                dock_open_on: Some(OpenTrigger::Click),
                tab_appearance: Some(TabAppearance::Solid),
                ..SettingsPatch::default()
            },
        )
        .expect("update");

        assert_eq!(get(&connection).expect("get"), settings);
        assert_eq!(settings.timings().open_trigger, OpenTrigger::Click);
        // Stored as the same lowercase strings the frontend sends.
        let raw: String = connection
            .query_row(
                "SELECT value FROM settings WHERE key = 'dock.openOn'",
                [],
                |row| row.get(0),
            )
            .expect("row");
        assert_eq!(raw, "\"click\"");
    }

    #[test]
    fn a_patch_touches_only_the_keys_it_names() {
        let connection = db();
        let patch = SettingsPatch {
            notes_last_color: Some(NoteColor::Mint),
            ..SettingsPatch::default()
        };

        let settings = update(&connection, &patch).expect("update");
        assert_eq!(settings.notes_last_color, NoteColor::Mint);
        assert_eq!(settings.dock_side, Side::Right);

        let rows: i64 = connection
            .query_row("SELECT count(*) FROM settings", [], |row| row.get(0))
            .expect("count");
        assert_eq!(rows, 1);
    }

    #[test]
    fn settings_survive_a_round_trip() {
        let connection = db();
        update(
            &connection,
            &SettingsPatch {
                dock_side: Some(Side::Left),
                theme: Some(Theme::Dark),
                dock_tab_offset: Some(0.25),
                ..SettingsPatch::default()
            },
        )
        .expect("update");

        let settings = get(&connection).expect("get");
        assert_eq!(settings.dock_side, Side::Left);
        assert_eq!(settings.theme, Theme::Dark);
        assert_eq!(settings.dock_tab_offset, 0.25);
    }

    #[test]
    fn writing_the_same_key_twice_replaces_it() {
        let connection = db();
        update(
            &connection,
            &SettingsPatch {
                theme: Some(Theme::Dark),
                ..SettingsPatch::default()
            },
        )
        .expect("first");
        let settings = update(
            &connection,
            &SettingsPatch {
                theme: Some(Theme::Light),
                ..SettingsPatch::default()
            },
        )
        .expect("second");

        assert_eq!(settings.theme, Theme::Light);
        let rows: i64 = connection
            .query_row(
                "SELECT count(*) FROM settings WHERE key = 'theme'",
                [],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(rows, 1);
    }

    #[test]
    fn out_of_range_values_are_clamped() {
        let connection = db();
        let settings = update(
            &connection,
            &SettingsPatch {
                dock_tab_offset: Some(9.0),
                panel_width: Some(1_000.0),
                ..SettingsPatch::default()
            },
        )
        .expect("update");

        assert_eq!(settings.dock_tab_offset, 1.0);
        assert_eq!(settings.panel_width, 420.0);
    }

    /// A value written by a future version, or corrupted, must not break startup.
    #[test]
    fn a_malformed_value_falls_back_to_the_default() {
        let connection = db();
        connection
            .execute(
                "INSERT INTO settings (key, value) VALUES ('theme', 'not json')",
                [],
            )
            .expect("insert");

        assert_eq!(get(&connection).expect("get").theme, Theme::System);
    }

    #[test]
    fn reminders_and_translucency_persist_and_translucency_is_capped() {
        let connection = db();
        let settings = update(
            &connection,
            &SettingsPatch {
                tasks_reminders: Some(false),
                panel_translucency: Some(35),
                ..SettingsPatch::default()
            },
        )
        .expect("update");
        assert!(!settings.tasks_reminders);
        assert_eq!(settings.panel_translucency, 35);

        let settings = update(
            &connection,
            &SettingsPatch {
                panel_translucency: Some(95),
                ..SettingsPatch::default()
            },
        )
        .expect("update");
        assert_eq!(settings.panel_translucency, MAX_PANEL_TRANSLUCENCY);
    }
}
