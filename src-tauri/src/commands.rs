//! The frontend's entire surface area (brief 9.3). M0 covers the dock commands;
//! notes and settings arrive in M1.

use std::sync::Arc;

use tauri::{AppHandle, Manager, State};

use crate::dock::{DOCK_WINDOW_LABEL, Dock, Input, Phase};
use crate::error::{AppError, AppResult};
use crate::platform;

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
