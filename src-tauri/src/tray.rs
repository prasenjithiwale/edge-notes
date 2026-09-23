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

/// The tray icon's id, so the focus timer can find it again to write a title.
pub const TRAY_ID: &str = "dock-tray";

const ID_OPEN: &str = "open";
const ID_NEW: &str = "new";
const ID_SIDE_LEFT: &str = "side-left";
const ID_SIDE_RIGHT: &str = "side-right";
const ID_AUTOSTART: &str = "autostart";
const ID_QUIT: &str = "quit";
const ID_UPDATE: &str = "update";

/// The check items are rebuilt from state on every menu event, so the handler
/// needs to reach them after the tray is built. They live in app state rather
/// than only in the menu closure because the settings view changes the same two
/// things, and a tick that disagrees with the panel is worse than no tick.
struct MenuHandles<R: Runtime> {
    side_left: CheckMenuItem<R>,
    side_right: CheckMenuItem<R>,
    autostart: CheckMenuItem<R>,
    menu: Menu<R>,
    /// Added the first time a check finds a new version (idea 6); there is no
    /// hidden menu item in Tauri 2.11, so it is inserted rather than shown.
    update: std::sync::Mutex<Option<MenuItem<R>>>,
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

/// Turn launch-at-login on or off. The settings view calls this too, so the
/// failure is returned rather than only logged: a switch that silently springs
/// back with no reason given is the bug this replaces.
pub fn set_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    match result {
        Ok(()) => {
            sync_menu(app);
            Ok(())
        }
        Err(error) => {
            log::error!("tray: failed to set launch at login: {error}");
            Err(error.to_string())
        }
    }
}

/// Whether launch-at-login is on, for the settings view.
#[must_use]
pub fn autostart_is_enabled(app: &AppHandle) -> bool {
    autostart_enabled(app)
}

/// Idea 6: put "Update to x.y.z and restart" at the top of the menu, or relabel
/// it if a later check found a newer one still.
pub fn show_update(app: &AppHandle, version: &str) {
    let Some(handles) = app.try_state::<MenuHandles<tauri::Wry>>() else {
        return;
    };
    let text = format!("Update to {version} and restart");
    let mut held = handles
        .update
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let result = match held.as_ref() {
        Some(item) => item.set_text(&text),
        None => MenuItem::with_id(app, ID_UPDATE, &text, true, None::<&str>).and_then(|item| {
            handles
                .menu
                .insert(&PredefinedMenuItem::separator(app)?, 0)?;
            handles.menu.insert(&item, 0)?;
            *held = Some(item);
            Ok(())
        }),
    };
    if let Err(error) = result {
        log::warn!("tray: could not show the update: {error}");
    }
}

/// Re-read the real state into the tray menu from wherever it changed.
pub fn sync_menu(app: &AppHandle) {
    if let Some(handles) = app.try_state::<MenuHandles<tauri::Wry>>() {
        sync_checks(app, &handles);
    }
}

/// Quit without losing the last keystrokes (brief 11: flush on quit).
///
/// Autosave is debounced in the frontend, so exiting at once dropped whatever
/// was typed in the last 400 ms. The webview is asked to write everything
/// pending and calls `app_quit` when done. A webview that is hung, or never
/// answers, must not make Quit do nothing, so the app exits anyway after
/// `QUIT_FLUSH_TIMEOUT`.
pub fn request_quit(app: &AppHandle) {
    if let Err(error) = app.emit(QUIT_REQUESTED_EVENT, ()) {
        log::error!("tray: failed to emit {QUIT_REQUESTED_EVENT}, quitting now: {error}");
        crate::updates::finish(app);
        return;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(QUIT_FLUSH_TIMEOUT);
        log::warn!("tray: pending notes were not confirmed saved in time; quitting anyway");
        crate::updates::finish(&handle);
    });
}

fn handle_event(app: &AppHandle, handles: &MenuHandles<tauri::Wry>, event: &MenuEvent) {
    match event.id().as_ref() {
        ID_OPEN => show_panel(app),
        ID_NEW => open_with_new_note(app),
        ID_SIDE_LEFT => set_side(app, Side::Left),
        ID_SIDE_RIGHT => set_side(app, Side::Right),
        ID_AUTOSTART => {
            let _ = set_autostart(app, !autostart_enabled(app));
        }
        ID_QUIT => {
            request_quit(app);
            return;
        }
        ID_UPDATE => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = crate::updates::install(&app).await {
                    log::error!("tray: update failed: {error}");
                }
            });
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
    let quit = MenuItem::with_id(app, ID_QUIT, "Quit Ledge", true, None::<&str>)?;

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
        side_left: side_left.clone(),
        side_right: side_right.clone(),
        autostart: launch.clone(),
        menu: menu.clone(),
        update: std::sync::Mutex::default(),
    };
    // A second set for `sync_menu`, so a change made in the settings view shows
    // in the tray. The items are `Arc` handles, so these are the same items.
    app.manage(MenuHandles {
        side_left,
        side_right,
        autostart: launch,
        menu: menu.clone(),
        update: std::sync::Mutex::default(),
    });

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
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

/// Which global shortcut a binding is, so one enum decides its setting, its
/// default and what pressing it does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Global {
    /// Brief 6.11: open the panel with a new note ready to type into.
    NewNote,
    /// Brief 14: the one-line capture field, without the panel.
    QuickCapture,
    /// Brief 14: the same field, with the clipboard already in it.
    ClipboardNote,
}

impl Global {
    /// Every binding, so registering them is a loop rather than three calls that
    /// can drift apart.
    pub const ALL: [Self; 3] = [Self::NewNote, Self::QuickCapture, Self::ClipboardNote];

    fn accelerator(self, settings: &Settings) -> String {
        match self {
            Self::NewNote => settings.shortcut_new_note.clone(),
            Self::QuickCapture => settings.shortcut_quick_capture.clone(),
            Self::ClipboardNote => settings.shortcut_clipboard_note.clone(),
        }
    }

    fn run(self, app: &AppHandle) {
        match self {
            Self::NewNote => open_with_new_note(app),
            Self::QuickCapture => crate::commands::open_quick_capture(app, None),
            Self::ClipboardNote => {
                // Read here, not in the webview: the frontend has no clipboard
                // permission and does not need one (brief 9.5).
                let text = read_clipboard(app);
                crate::commands::open_quick_capture(app, text);
            }
        }
    }
}

fn read_clipboard(app: &AppHandle) -> Option<String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    match app.clipboard().read_text() {
        Ok(text) if !text.trim().is_empty() => Some(text),
        Ok(_) => None,
        Err(error) => {
            log::error!("clipboard: could not read text: {error}");
            None
        }
    }
}

/// The settings the bindings come from, falling back to the defaults if the
/// database cannot be read — a shortcut is not worth failing startup over.
fn shortcut_settings(app: &AppHandle) -> Settings {
    app.try_state::<Database>()
        .and_then(|db| db.with(settings::get).ok())
        .unwrap_or_default()
}

/// Register every global shortcut from the settings, replacing whatever is bound
/// now.
///
/// All of them together, because the plugin's `unregister_all` is the only
/// idempotent way to rebind and it takes the others with it. An accelerator that
/// is empty is deliberately not bound: that is how a shortcut is turned off.
fn register_shortcuts(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let shortcuts = app.global_shortcut();
    if let Err(error) = shortcuts.unregister_all() {
        log::warn!("shortcut: could not clear existing shortcuts: {error}");
    }

    let mut failed: Option<String> = None;
    for binding in Global::ALL {
        let accelerator = binding.accelerator(settings);
        if accelerator.trim().is_empty() {
            continue;
        }
        let result = shortcuts.on_shortcut(accelerator.as_str(), move |app, _shortcut, event| {
            // Both press and release arrive; acting on each would do it twice.
            if event.state() == ShortcutState::Pressed {
                binding.run(app);
            }
        });
        if let Err(error) = result {
            log::error!("shortcut: could not register {accelerator}: {error}");
            failed.get_or_insert_with(|| error.to_string());
        }
    }
    failed.map_or(Ok(()), Err)
}

/// Brief 6.11 and 14: the global shortcuts, bound from the settings at startup.
///
/// Each accelerator is a setting, so someone who has already given a combination
/// to another app can move it.
pub fn bind_shortcuts(app: &AppHandle) {
    let settings = shortcut_settings(app);
    if let Err(error) = register_shortcuts(app, &settings) {
        // A shortcut another app already owns must not stop the widget from
        // starting, or from accepting the rest of a settings change.
        log::error!("shortcut: some shortcuts could not be registered: {error}");
    }
}

/// Re-bind after a setting changes, so a new accelerator works immediately.
///
/// Unlike [`bind_shortcuts`] this reports failure and puts the old set back when
/// the new accelerator is refused. Registration clears the old bindings before it
/// tries the new ones, so without that restore a rejected accelerator left the
/// app with no shortcuts at all and nothing on screen saying so.
pub fn try_rebind_shortcuts(
    app: &AppHandle,
    wanted: &Settings,
    previous: &Settings,
) -> Result<(), String> {
    match register_shortcuts(app, wanted) {
        Ok(()) => Ok(()),
        Err(error) => {
            if let Err(restore) = register_shortcuts(app, previous) {
                log::error!("shortcut: could not restore the previous shortcuts: {restore}");
            }
            Err(error)
        }
    }
}

/// Re-bind from what is stored, after the settings have already been written.
pub fn rebind_shortcuts(app: &AppHandle) {
    bind_shortcuts(app);
}
