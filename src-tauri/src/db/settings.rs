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
    #[serde(rename = "panel.width")]
    pub panel_width: f64,
    #[serde(rename = "theme")]
    pub theme: Theme,
    #[serde(rename = "notes.lastColor")]
    pub notes_last_color: NoteColor,
    #[serde(rename = "shortcut.newNote")]
    pub shortcut_new_note: String,
}

impl Settings {
    /// The placement half of the settings, for the dock (brief 9.2).
    pub fn placement(&self) -> crate::dock::Placement {
        crate::dock::Placement {
            side: self.dock_side,
            tab_offset: self.dock_tab_offset,
            panel_width: self.panel_width,
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
            panel_width: 320.0,
            theme: Theme::System,
            notes_last_color: NoteColor::Yellow,
            shortcut_new_note: "CmdOrCtrl+Alt+N".to_owned(),
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
    #[serde(rename = "panel.width")]
    pub panel_width: Option<f64>,
    #[serde(rename = "theme")]
    pub theme: Option<Theme>,
    #[serde(rename = "notes.lastColor")]
    pub notes_last_color: Option<NoteColor>,
    #[serde(rename = "shortcut.newNote")]
    pub shortcut_new_note: Option<String>,
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
        panel_width: read(connection, "panel.width", defaults.panel_width)?,
        theme: read(connection, "theme", defaults.theme)?,
        notes_last_color: read(connection, "notes.lastColor", defaults.notes_last_color)?,
        shortcut_new_note: read(connection, "shortcut.newNote", defaults.shortcut_new_note)?,
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
    if let Some(value) = &patch.shortcut_new_note {
        write(connection, "shortcut.newNote", value)?;
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
        assert_eq!(settings.tab_appearance, TabAppearance::Translucent);
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
}
