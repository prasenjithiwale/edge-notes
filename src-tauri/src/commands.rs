//! The frontend's entire surface area (brief 9.3). M0 covers the dock commands;
//! notes and settings arrive in M1.

use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::{Database, Note, NoteColor, Settings, SettingsPatch, notes, now_ms, settings};
use crate::dock::{DOCK_WINDOW_LABEL, Dock, Input, Phase};
use crate::error::{AppError, AppResult};
use crate::platform;

/// Brief 9.4.
const SETTINGS_CHANGED_EVENT: &str = "settings:changed";

/// The frontend has painted: position and show the window. Keeping it hidden
/// until now is what avoids a white flash at startup (brief 7.5).
#[tauri::command]
pub fn app_ready(app: AppHandle, dock: State<'_, Arc<Dock>>) -> AppResult<()> {
    let window = app
        .get_webview_window(DOCK_WINDOW_LABEL)
        .ok_or(AppError::WindowNotFound(DOCK_WINDOW_LABEL))?;

    dock.input(&app, Input::MonitorChanged);
    platform::show(&window);
    Ok(())
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
    // Applying dock side, delays and width live is M3; persisting and announcing
    // them is all M1 needs.
    if let Err(error) = app.emit(SETTINGS_CHANGED_EVENT, &updated) {
        eprintln!("settings: failed to emit change: {error}");
    }
    Ok(updated)
}
