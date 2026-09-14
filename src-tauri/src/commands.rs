//! The frontend's entire surface area (brief 9.3). M0 covers the dock commands;
//! notes and settings arrive in M1.

use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::{Database, Note, NoteColor, Settings, SettingsPatch, notes, now_ms, settings};
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
        if patch.dock_open_delay_ms.is_some()
            || patch.dock_close_delay_ms.is_some()
            || patch.dock_open_on.is_some()
        {
            dock.set_timings(updated.timings());
        }
    }

    if let Some(accelerator) = patch.shortcut_new_note.as_deref() {
        crate::tray::rebind_new_note_shortcut(&app, accelerator);
    }

    if let Err(error) = app.emit(SETTINGS_CHANGED_EVENT, &updated) {
        log::error!("settings: failed to emit change: {error}");
    }
    Ok(updated)
}
