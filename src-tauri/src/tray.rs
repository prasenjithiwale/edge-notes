//! The tray menu (brief 6.12) and the two ways the panel is summoned
//! deliberately: the tray itself and the global shortcut.

use std::sync::Arc;

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::db::{Database, Settings, SettingsPatch, settings};
use crate::dock::{Dock, Input, Side, poller};

/// Brief 9.4: the frontend opens a new note in the editor when it sees this.
pub const NEW_NOTE_EVENT: &str = "ui:new-note";

/// Asks the frontend to save anything pending; it answers with `app_quit`.
pub const QUIT_REQUESTED_EVENT: &str = "app:quit-requested";

/// How long Quit waits for that answer. A save is one SQLite write per note
/// with unsaved text, so this is generous; it only matters if the webview hangs.
const QUIT_FLUSH_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(1_500);

const ID_OPEN: &str = "open";
const ID_NEW: &str = "new";
const ID_SIDE_LEFT: &str = "side-left";
const ID_SIDE_RIGHT: &str = "side-right";
const ID_AUTOSTART: &str = "autostart";
const ID_QUIT: &str = "quit";

/// The check items are rebuilt from state on every menu event, so the handler
/// needs to reach them after the tray is built.
struct MenuHandles<R: Runtime> {
    side_left: CheckMenuItem<R>,
    side_right: CheckMenuItem<R>,
    autostart: CheckMenuItem<R>,
}

/// Whether launch-at-login is on. The OS is the only honest source for this —
/// the user can remove the login item outside the app — so it is read rather
/// than mirrored into the settings table.
fn autostart_enabled<R: Runtime>(app: &AppHandle<R>) -> bool {
    match app.autolaunch().is_enabled() {
        Ok(value) => value,
        Err(error) => {
            log::warn!("tray: could not read launch-at-login state: {error}");
            false
        }
    }
}

fn current_side(app: &AppHandle) -> Side {
    app.try_state::<Database>()
        .and_then(|db| db.with(settings::get).ok())
        .map_or(Side::Right, |settings| settings.dock_side)
}

/// Show the panel without toggling it shut when it is already open: the tray, the
/// shortcut and a second launch all mean "show me the notes", never "hide them".
pub fn show_panel(app: &AppHandle) {
    let Some(dock) = app.try_state::<Arc<Dock>>() else {
        return;
    };
    if dock.phase().is_expanded() {
        return;
    }
    dock.input(app, Input::Toggle);
}

/// Brief 6.11: the global shortcut opens the panel with a new note in the editor.
pub fn open_with_new_note(app: &AppHandle) {
    show_panel(app);
    if let Err(error) = app.emit(NEW_NOTE_EVENT, ()) {
        log::error!("tray: failed to emit {NEW_NOTE_EVENT}: {error}");
    }
}

/// Move the dock to the other edge and apply it immediately, without a restart.
fn set_side(app: &AppHandle, side: Side) {
    let Some(db) = app.try_state::<Database>() else {
        return;
    };
    let patch = SettingsPatch {
        dock_side: Some(side),
        ..SettingsPatch::default()
    };
    let updated = match db.with(|connection| settings::update(connection, &patch)) {
        Ok(updated) => updated,
        Err(error) => {
            log::error!("tray: failed to save dock side: {error}");
            return;
        }
    };

    if let Some(dock) = app.try_state::<Arc<Dock>>() {
        let geometry = poller::geometry_for(app, &updated.placement());
        dock.set_geometry(app, geometry);
    }
    if let Err(error) = app.emit(crate::commands::SETTINGS_CHANGED_EVENT, &updated) {
        log::error!("tray: failed to announce settings change: {error}");
    }
}

fn set_autostart(app: &AppHandle, enabled: bool) {
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    if let Err(error) = result {
        log::error!("tray: failed to set launch at login: {error}");
    }
}

/// Quit without losing the last keystrokes (brief 11: flush on quit).
///
/// Autosave is debounced in the frontend, so exiting at once dropped whatever
/// was typed in the last 400 ms. The webview is asked to write everything
/// pending and calls `app_quit` when done. A webview that is hung, or never
/// answers, must not make Quit do nothing, so the app exits anyway after
/// `QUIT_FLUSH_TIMEOUT`.
fn request_quit(app: &AppHandle) {
    if let Err(error) = app.emit(QUIT_REQUESTED_EVENT, ()) {
        log::error!("tray: failed to emit {QUIT_REQUESTED_EVENT}, quitting now: {error}");
        app.exit(0);
        return;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(QUIT_FLUSH_TIMEOUT);
        log::warn!("tray: pending notes were not confirmed saved in time; quitting anyway");
        handle.exit(0);
    });
}

fn handle_event(app: &AppHandle, handles: &MenuHandles<tauri::Wry>, event: &MenuEvent) {
    match event.id().as_ref() {
        ID_OPEN => show_panel(app),
        ID_NEW => open_with_new_note(app),
        ID_SIDE_LEFT => set_side(app, Side::Left),
        ID_SIDE_RIGHT => set_side(app, Side::Right),
        ID_AUTOSTART => set_autostart(app, !autostart_enabled(app)),
        ID_QUIT => {
            request_quit(app);
            return;
        }
        _ => return,
    }
    sync_checks(app, handles);
}

/// Re-read the real state into the menu. The two side items act as a radio pair:
/// Tauri 2.11 has no radio menu item, so one is set as the other is cleared.
fn sync_checks(app: &AppHandle, handles: &MenuHandles<tauri::Wry>) {
    let side = current_side(app);
    let autostart = autostart_enabled(app);

    for (item, value) in [
        (&handles.side_left, side == Side::Left),
        (&handles.side_right, side == Side::Right),
        (&handles.autostart, autostart),
    ] {
        if let Err(error) = item.set_checked(value) {
            log::warn!("tray: failed to update a menu check: {error}");
        }
    }
}

/// Build the tray icon and its menu. Called once during setup.
pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let side = current_side(app);
    let autostart = autostart_enabled(app);

    let open = MenuItem::with_id(app, ID_OPEN, "Open notes", true, None::<&str>)?;
    let new_note = MenuItem::with_id(app, ID_NEW, "New note", true, None::<&str>)?;
    let side_left = CheckMenuItem::with_id(
        app,
        ID_SIDE_LEFT,
        "Dock on left",
        true,
        side == Side::Left,
        None::<&str>,
    )?;
    let side_right = CheckMenuItem::with_id(
        app,
        ID_SIDE_RIGHT,
        "Dock on right",
        true,
        side == Side::Right,
        None::<&str>,
    )?;
    let launch = CheckMenuItem::with_id(
        app,
        ID_AUTOSTART,
        "Launch at login",
        true,
        autostart,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, ID_QUIT, "Quit Edge Notes", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &open,
            &new_note,
            &PredefinedMenuItem::separator(app)?,
            &side_left,
            &side_right,
            &PredefinedMenuItem::separator(app)?,
            &launch,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let handles = MenuHandles {
        side_left,
        side_right,
        autostart: launch,
    };

    let mut builder = TrayIconBuilder::with_id("dock-tray")
        .menu(&menu)
        // Left-clicking opens the menu rather than toggling the panel: the tab is
        // already the way to open by pointing at it.
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| {
            handle_event(app, &handles, &event);
        });

    // A monochrome outline, not the app icon: macOS uses only a template image's
    // alpha, so the coloured app icon rendered as a solid black blob. Drawn at
    // 2x so it stays crisp on a Retina menu bar; `tools/make_icons.py` builds it.
    match Image::from_bytes(include_bytes!("../icons/tray@2x.png")) {
        Ok(icon) => {
            builder = builder.icon(icon);
            #[cfg(target_os = "macos")]
            {
                builder = builder.icon_as_template(true);
            }
        }
        Err(error) => {
            log::error!("tray: could not load the tray icon: {error}");
            if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }
        }
    }

    builder.build(app)?;
    Ok(())
}

/// Brief 6.11: one global shortcut, opening the panel with a new note ready to
/// type into. The accelerator is a setting, so someone who has already given
/// `CmdOrCtrl+Alt+N` to another app can move it.
///
/// `accelerator` is `None` at startup, meaning "whatever is stored".
pub fn bind_new_note_shortcut(app: &AppHandle, accelerator: Option<&str>) {
    let accelerator = accelerator.map_or_else(
        || {
            app.try_state::<Database>()
                .and_then(|db| db.with(settings::get).ok())
                .map_or_else(
                    || Settings::default().shortcut_new_note,
                    |settings| settings.shortcut_new_note,
                )
        },
        ToOwned::to_owned,
    );

    let shortcuts = app.global_shortcut();
    // Only ever one shortcut is registered, so clearing the lot is the simplest
    // way to make rebinding idempotent.
    if let Err(error) = shortcuts.unregister_all() {
        log::warn!("shortcut: could not clear existing shortcuts: {error}");
    }

    let result = shortcuts.on_shortcut(accelerator.as_str(), |app, _shortcut, event| {
        // Both press and release arrive; acting on each would open two notes.
        if event.state() == ShortcutState::Pressed {
            open_with_new_note(app);
        }
    });

    if let Err(error) = result {
        // A shortcut another app already owns must not stop the widget from
        // starting, or from accepting the rest of a settings change.
        log::error!("shortcut: could not register {accelerator}: {error}");
    }
}

/// Re-bind after the setting changes, so a new accelerator works immediately.
pub fn rebind_new_note_shortcut(app: &AppHandle, accelerator: &str) {
    bind_new_note_shortcut(app, Some(accelerator));
}
