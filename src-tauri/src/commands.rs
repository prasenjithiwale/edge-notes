//! The frontend's entire surface area (brief 9.3). M0 covers the dock commands;
//! notes and settings arrive in M1.

use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::{
    ArchivedItem, ArchivedKind, Database, Note, NoteColor, Settings, SettingsPatch, Status, Task,
    TaskPatch, archive, notes, now_ms, settings, tasks,
};
use crate::dock::{DOCK_WINDOW_LABEL, Dock, Input, Phase, poller};
use crate::error::{AppError, AppResult};
use crate::platform;

/// Brief 9.4.
pub const SETTINGS_CHANGED_EVENT: &str = "settings:changed";

/// The frontend has painted: position and show the window. Keeping it hidden
/// until now is what avoids a white flash at startup (brief 7.5).
#[tauri::command]
pub fn app_ready(app: AppHandle, dock: State<'_, Arc<Dock>>) -> AppResult<()> {
    // Fail early and loudly if the window is missing, rather than inside the
    // closure below where the error would have nowhere to go.
    if app.get_webview_window(DOCK_WINDOW_LABEL).is_none() {
        return Err(AppError::WindowNotFound(DOCK_WINDOW_LABEL));
    }

    dock.input(&app, Input::MonitorChanged);

    // Showing converts to panel operations on macOS, which must run on the main
    // thread (brief 8.8); command handlers do not always run there.
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window(DOCK_WINDOW_LABEL) {
            platform::show(&window);
        }
    })?;
    Ok(())
}

/// The frontend has saved everything pending after `app:quit-requested`, so the
/// app can exit now rather than waiting out the tray's fallback timeout.
#[tauri::command]
pub fn app_quit(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn dock_set_keep_open(
    app: AppHandle,
    dock: State<'_, Arc<Dock>>,
    value: bool,
) -> AppResult<()> {
    dock.input(&app, Input::SetKeepOpen(value));
    Ok(())
}

#[tauri::command]
pub fn dock_set_interaction_lock(
    app: AppHandle,
    dock: State<'_, Arc<Dock>>,
    value: bool,
) -> AppResult<()> {
    dock.input(&app, Input::SetInteractionLock(value));
    Ok(())
}

#[tauri::command]
pub fn dock_animation_done(
    app: AppHandle,
    dock: State<'_, Arc<Dock>>,
    phase: Phase,
) -> AppResult<()> {
    dock.input(&app, Input::AnimationDone(phase));
    Ok(())
}

#[tauri::command]
pub fn dock_toggle(app: AppHandle, dock: State<'_, Arc<Dock>>) -> AppResult<()> {
    dock.input(&app, Input::Toggle);
    Ok(())
}

/// Grow the open panel so a note can be read and edited at a comfortable size,
/// or return it to normal. Ignored while collapsed.
#[tauri::command]
pub fn dock_set_large(app: AppHandle, dock: State<'_, Arc<Dock>>, value: bool) -> AppResult<()> {
    dock.input(&app, Input::SetLarge(value));
    Ok(())
}

/// Open a web link from a note in the default browser. See `links` for why this
/// is a command rather than a navigation.
#[tauri::command]
pub fn open_url(url: String) -> AppResult<()> {
    crate::links::open(&url)
}

/// The full list of task reminders, sent by the frontend whenever notes change.
#[tauri::command]
pub fn reminders_set(
    reminders: State<'_, Arc<crate::reminders::Reminders>>,
    list: Vec<crate::reminders::Reminder>,
) {
    reminders.set(list);
}

/// The pointer left the webview. Brief 8.2 and 8.10: on Linux the polled cursor
/// can go stale once the pointer is over a native Wayland window, so this backs
/// it up. The controller ignores it unless the cursor really is outside, which
/// makes it harmless on macOS and Windows.
#[tauri::command]
pub fn dock_pointer_left(app: AppHandle, dock: State<'_, Arc<Dock>>) -> AppResult<()> {
    dock.input(&app, Input::PointerLeftWebview);
    Ok(())
}

// -- Notes (brief 9.3) ------------------------------------------------------

/// Active notes, most recently edited first.
#[tauri::command]
pub fn notes_list(db: State<'_, Database>) -> AppResult<Vec<Note>> {
    db.with(notes::list)
}

/// Create an empty note and remember the colour for the next one.
#[tauri::command]
pub fn notes_create(db: State<'_, Database>, color: NoteColor) -> AppResult<Note> {
    db.with(|connection| {
        let note = notes::create(connection, color, now_ms())?;
        settings::update(
            connection,
            &SettingsPatch {
                notes_last_color: Some(color),
                ..SettingsPatch::default()
            },
        )?;
        Ok(note)
    })
}

/// Partial update; bumps `updated_at`, which re-sorts the list.
#[tauri::command]
pub fn notes_update(
    db: State<'_, Database>,
    id: String,
    content: Option<String>,
    color: Option<NoteColor>,
) -> AppResult<Note> {
    db.with(|connection| notes::update(connection, &id, content.as_deref(), color, now_ms()))
}

/// Pin or unpin a note. Pinned notes sort to the top and are read-only on the
/// card until their edit button is used.
#[tauri::command]
pub fn notes_set_pinned(db: State<'_, Database>, id: String, pinned: bool) -> AppResult<Note> {
    db.with(|connection| notes::set_pinned(connection, &id, pinned))
}

/// Soft delete, so the undo toast can put it straight back.
#[tauri::command]
pub fn notes_delete(db: State<'_, Database>, id: String) -> AppResult<()> {
    db.with(|connection| notes::delete(connection, &id, now_ms()))
}

#[tauri::command]
pub fn notes_restore(db: State<'_, Database>, id: String) -> AppResult<Note> {
    db.with(|connection| notes::restore(connection, &id))
}

/// Everything deleted and not yet purged, notes and tasks together, newest
/// first. What is put back goes through `notes_restore` and `tasks_restore`,
/// which already existed for undo: the archive is a second way to reach the
/// same door, not a second door.
#[tauri::command]
pub fn archive_list(db: State<'_, Database>) -> AppResult<Vec<ArchivedItem>> {
    db.with(archive::list)
}

/// Delete one archived thing for good, rather than waiting out its thirty days.
///
/// The only command in the app that destroys anything, and the only one with no
/// undo behind it. It can reach nothing but a row that is already deleted, which
/// is enforced in the SQL rather than here.
#[tauri::command]
pub fn archive_purge(db: State<'_, Database>, id: String, kind: ArchivedKind) -> AppResult<()> {
    db.with(|connection| archive::purge_one(connection, &id, kind))
}

// -- Settings ---------------------------------------------------------------

/// Brief M4: the tab can be dragged along the edge to reposition it.
///
/// Rust drives the drag because the window moves with the tab: the frontend's own
/// coordinates shift under the pointer mid-drag, while the poller already has the
/// cursor in desktop coordinates.
#[tauri::command]
pub fn dock_begin_tab_drag(app: AppHandle, dock: State<'_, Arc<Dock>>) -> AppResult<()> {
    dock.input(&app, Input::BeginTabDrag);
    Ok(())
}

/// Dropped: keep where it landed (brief 8.5 stores it as a ratio).
#[tauri::command]
pub fn dock_end_tab_drag(
    app: AppHandle,
    dock: State<'_, Arc<Dock>>,
    db: State<'_, Database>,
) -> AppResult<()> {
    let before = dock.tab_offset();
    dock.input(&app, Input::EndTabDrag);
    // A press that never moved is a click (and opens the panel in click mode):
    // nothing to persist, and settings rows are written only when they change.
    if (dock.tab_offset() - before).abs() < f64::EPSILON {
        return Ok(());
    }

    let patch = SettingsPatch {
        dock_tab_offset: Some(dock.tab_offset()),
        ..SettingsPatch::default()
    };
    let updated = db.with(|connection| settings::update(connection, &patch))?;
    if let Err(error) = app.emit(SETTINGS_CHANGED_EVENT, &updated) {
        log::error!("dock: failed to announce the dropped tab position: {error}");
    }
    Ok(())
}

/// Brief M4: write every note out as Markdown, plus a JSON backup.
///
/// It goes to the documents folder rather than asking where: a save dialog would
/// mean `tauri-plugin-dialog`, which is outside brief section 4. The path comes
/// back so the panel can say where the notes went.
#[tauri::command]
pub fn notes_export(app: AppHandle, db: State<'_, Database>) -> AppResult<String> {
    let notes = db.with(notes::list)?;
    let parent = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(AppError::from)?;

    let directory = crate::export::write_all(&parent, &notes, now_ms())?;
    log::info!(
        "export: wrote {} notes to {}",
        notes.len(),
        directory.display()
    );
    Ok(directory.to_string_lossy().into_owned())
}

/// What the About section shows, and what a bug report needs.
///
/// Assembled here rather than read from the frontend: the version is Tauri's own
/// package info, which comes from `package.json` through `tauri.conf.json`, and
/// the data directory is a path — neither is something the webview has, or
/// should have, a way to ask the system for itself (brief 9.5).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    /// "macOS", "Windows", "Linux" — the name a person would write, not the
    /// target triple's.
    pub os: String,
    pub arch: String,
    /// Where `notes.db` lives. People do ask where their notes are.
    pub data_dir: String,
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppResult<AppInfo> {
    let package = app.package_info();
    Ok(AppInfo {
        name: package.name.clone(),
        version: package.version.to_string(),
        os: pretty_os(std::env::consts::OS),
        arch: std::env::consts::ARCH.to_owned(),
        data_dir: app
            .path()
            .app_data_dir()
            .map(|path| path.display().to_string())
            .unwrap_or_default(),
    })
}

/// The key, and where the database it opens lives.
///
/// Managed state rather than a global: the key is needed by three commands and
/// by nothing else, and it is behind a mutex because unlocking replaces it from
/// whatever thread the command ran on.
pub struct Vault {
    path: std::path::PathBuf,
    state: std::sync::Mutex<crate::db::vault::Opened>,
}

impl Vault {
    #[must_use]
    pub fn new(path: std::path::PathBuf, opened: crate::db::vault::Opened) -> Self {
        Self {
            path,
            state: std::sync::Mutex::new(opened),
        }
    }

    fn with<T>(&self, action: impl FnOnce(&mut crate::db::vault::Opened) -> T) -> T {
        match self.state.lock() {
            Ok(mut state) => action(&mut state),
            Err(poisoned) => action(&mut poisoned.into_inner()),
        }
    }
}

/// What the app can and does do to protect what is in it, for the settings view
/// and for the panel, which has to draw a locked state rather than an empty one.
///
/// A capability as well as a state: a switch the platform cannot honour should
/// not be drawn at all.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityStatus {
    /// Whether this platform can keep the panel out of a capture (idea 1).
    pub capture_protection: bool,
    /// Whether the notes on disk are encrypted, unreadable, or in the clear.
    pub protection: crate::db::Protection,
    /// Why, when it is not simply on. A sentence, for showing to the user.
    pub detail: String,
}

#[tauri::command]
pub fn security_status(vault: State<'_, Vault>) -> SecurityStatus {
    vault.with(|state| SecurityStatus {
        capture_protection: platform::capture_protection_supported(),
        protection: state.protection,
        detail: state.detail.clone(),
    })
}

/// The key, written out for someone to keep.
///
/// The one place it is ever shown. There is nothing to show when the database is
/// not encrypted, and nothing to show when it is locked — the key is what is
/// missing.
#[tauri::command]
pub fn security_recovery_key(vault: State<'_, Vault>) -> AppResult<String> {
    vault.with(|state| {
        state
            .key
            .as_ref()
            .map(crate::db::DatabaseKey::recovery_key)
            .ok_or_else(|| AppError::Locked("there is no key to show".to_owned()))
    })
}

/// Open a locked database with a key the user kept.
///
/// The connection is swapped underneath every command that already holds the
/// `Database`, so nothing else has to know this happened.
#[tauri::command]
pub fn security_unlock(
    app: AppHandle,
    db: State<'_, Database>,
    vault: State<'_, Vault>,
    recovery: String,
) -> AppResult<SecurityStatus> {
    let key = crate::db::DatabaseKey::parse(&recovery).ok_or_else(|| {
        AppError::Locked(
            "that is not a recovery key: it should be 64 letters and digits".to_owned(),
        )
    })?;
    let path = vault.path.clone();
    let connection = crate::db::vault::unlock(&path, &key)
        .map_err(|_| AppError::Locked("that key does not open these notes".to_owned()))?;
    db.adopt(connection)?;

    vault.with(|state| {
        state.protection = crate::db::Protection::On;
        state.detail = String::new();
        state.key = Some(key.clone());
    });
    log::info!("db: the notes were unlocked with a recovery key");
    settings_after_unlock(&app, &db);
    Ok(security_status(vault))
}

/// Give up on a database nobody has the key for and start again.
///
/// The old file is renamed rather than deleted, so a key found next week still
/// has something to open.
#[tauri::command]
pub fn security_start_fresh(
    app: AppHandle,
    db: State<'_, Database>,
    vault: State<'_, Vault>,
) -> AppResult<SecurityStatus> {
    let locked = vault.with(|state| state.protection == crate::db::Protection::Locked);
    if !locked {
        return Err(AppError::Locked(
            "the notes are not locked, so there is nothing to set aside".to_owned(),
        ));
    }

    let path = vault.path.clone();
    let (aside, connection, opened) = crate::db::vault::set_aside(&path)?;
    db.adopt(connection)?;
    log::warn!("db: the locked notes were set aside as {}", aside.display());
    vault.with(|state| *state = opened);
    settings_after_unlock(&app, &db);
    Ok(security_status(vault))
}

/// After the database underneath the app changes, the settings in it are a
/// different set: tell the frontend, so it is not showing the empty defaults the
/// locked database had.
fn settings_after_unlock(app: &AppHandle, db: &Database) {
    let Ok(settings) = db.with(settings::get) else {
        return;
    };
    if let Err(error) = app.emit(SETTINGS_CHANGED_EVENT, &settings) {
        log::error!("settings: failed to emit change after unlock: {error}");
    }
}

/// `std::env::consts::OS` is lowercase and terse; this is the same thing spelled
/// the way the platform spells itself. Anything unknown is passed through rather
/// than guessed at.
fn pretty_os(os: &str) -> String {
    match os {
        "macos" => "macOS".to_owned(),
        "windows" => "Windows".to_owned(),
        "linux" => "Linux".to_owned(),
        other => other.to_owned(),
    }
}

/// The monitors the dock can be placed on, by name (brief 9.2 `dock.monitor`).
/// Not in brief 9.3: the settings view cannot offer a choice it cannot enumerate.
#[tauri::command]
pub fn monitors_list(app: AppHandle) -> AppResult<Vec<String>> {
    let monitors = app.available_monitors().unwrap_or_default();
    Ok(monitors
        .into_iter()
        .filter_map(|monitor| monitor.name().cloned())
        .collect())
}

#[tauri::command]
pub fn settings_get(db: State<'_, Database>) -> AppResult<Settings> {
    db.with(settings::get)
}

#[tauri::command]
pub fn settings_update(
    app: AppHandle,
    db: State<'_, Database>,
    patch: SettingsPatch,
) -> AppResult<Settings> {
    let updated = db.with(|connection| settings::update(connection, &patch))?;

    // Brief 9.3: settings apply immediately. Anything that only took effect on the
    // next launch would make the settings view look broken.
    if let Some(dock) = app.try_state::<Arc<Dock>>() {
        if patch.dock_side.is_some()
            || patch.dock_tab_offset.is_some()
            || patch.panel_width.is_some()
            || patch.dock_monitor.is_some()
        {
            let geometry = poller::geometry_for(&app, &updated.placement());
            dock.set_geometry(&app, geometry);
        }
        if let (Some(enabled), Some(reminders)) = (
            patch.tasks_reminders,
            app.try_state::<Arc<crate::reminders::Reminders>>(),
        ) {
            reminders.set_enabled(enabled);
        }
        if patch.dock_open_delay_ms.is_some()
            || patch.dock_close_delay_ms.is_some()
            || patch.dock_open_on.is_some()
        {
            dock.set_timings(updated.timings());
        }
    }

    if let Some(hidden) = patch.privacy_hide_from_capture
        && let Some(window) = app.get_webview_window(crate::dock::DOCK_WINDOW_LABEL)
    {
        crate::platform::set_hidden_from_capture(&window, hidden);
    }

    if let Some(accelerator) = patch.shortcut_new_note.as_deref() {
        crate::tray::rebind_new_note_shortcut(&app, accelerator);
    }

    // The tray shows the dock side too, and the settings view can change it.
    if patch.dock_side.is_some() {
        crate::tray::sync_menu(&app);
    }

    if let Err(error) = app.emit(SETTINGS_CHANGED_EVENT, &updated) {
        log::error!("settings: failed to emit change: {error}");
    }
    Ok(updated)
}

/// Set the global shortcut, refusing an accelerator the OS will not give us.
///
/// Registration is tried *before* the value is stored, and the previous binding
/// is restored if it fails, so the settings field can never leave the app with a
/// shortcut that does nothing. `settings_update` writes first and binds after,
/// which is right for every other key but wrong for this one.
#[tauri::command]
pub fn shortcut_set(
    app: AppHandle,
    db: State<'_, Database>,
    accelerator: String,
) -> AppResult<Settings> {
    let trimmed = accelerator.trim();
    if trimmed.is_empty() {
        return Err(AppError::ShortcutUnavailable(
            "that is not a shortcut".to_owned(),
        ));
    }

    let previous = crate::tray::stored_shortcut(&app);
    crate::tray::try_rebind_new_note_shortcut(&app, trimmed, &previous)
        .map_err(AppError::ShortcutUnavailable)?;

    let patch = SettingsPatch {
        shortcut_new_note: Some(trimmed.to_owned()),
        ..SettingsPatch::default()
    };
    let updated = db.with(|connection| settings::update(connection, &patch))?;

    if let Err(error) = app.emit(SETTINGS_CHANGED_EVENT, &updated) {
        log::error!("settings: failed to emit change: {error}");
    }
    Ok(updated)
}

/// Whether the app starts at login. Read from the OS, never mirrored into the
/// settings table: the login item can be removed from outside the app.
#[tauri::command]
pub fn autostart_get(app: AppHandle) -> AppResult<bool> {
    Ok(crate::tray::autostart_is_enabled(&app))
}

/// Brief 6.12's tray checkbox, also offered in the settings view. Returns what
/// the OS reports afterwards rather than what was asked for.
#[tauri::command]
pub fn autostart_set(app: AppHandle, enabled: bool) -> AppResult<bool> {
    crate::tray::set_autostart(&app, enabled).map_err(AppError::Autostart)?;
    Ok(crate::tray::autostart_is_enabled(&app))
}

// -- Tasks ------------------------------------------------------------------

/// Every task that has not been deleted, open and done alike. Which ones the
/// list shows, and in what order, is the frontend's decision: it depends on the
/// reader's clock, and Rust has no business grouping by "today".
#[tauri::command]
pub fn tasks_list(db: State<'_, Database>) -> AppResult<Vec<Task>> {
    db.with(tasks::list)
}

#[tauri::command]
pub fn tasks_create(db: State<'_, Database>, patch: TaskPatch) -> AppResult<Task> {
    db.with(|connection| tasks::create(connection, &patch, now_ms()))
}

/// Partial update. A field the patch leaves out is untouched; sending it as null
/// clears it.
#[tauri::command]
pub fn tasks_update(db: State<'_, Database>, id: String, patch: TaskPatch) -> AppResult<Task> {
    db.with(|connection| tasks::update(connection, &id, &patch, now_ms()))
}

/// Move a task to a status: open, in progress, done or cancelled.
///
/// The only way a status changes, so the time a task closed is stamped in one
/// place. A repeating task is never completed through this: the frontend moves
/// it to its next date with `tasks_update`, because calendar months and local
/// time are its department.
#[tauri::command]
pub fn tasks_set_status(db: State<'_, Database>, id: String, status: Status) -> AppResult<Task> {
    db.with(|connection| tasks::set_status(connection, &id, status, now_ms()))
}

#[tauri::command]
pub fn tasks_delete(db: State<'_, Database>, id: String) -> AppResult<()> {
    db.with(|connection| tasks::delete(connection, &id, now_ms()))
}

#[tauri::command]
pub fn tasks_restore(db: State<'_, Database>, id: String) -> AppResult<Task> {
    db.with(|connection| tasks::restore(connection, &id))
}

#[cfg(test)]
mod tests {
    use super::pretty_os;

    #[test]
    fn the_os_is_spelled_the_way_the_platform_spells_itself() {
        assert_eq!(pretty_os("macos"), "macOS");
        assert_eq!(pretty_os("windows"), "Windows");
        assert_eq!(pretty_os("linux"), "Linux");
        // Not guessed at: a target we have never run on is shown as it is.
        assert_eq!(pretty_os("freebsd"), "freebsd");
    }
}
