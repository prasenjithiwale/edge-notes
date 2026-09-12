//! Edge Notes: an edge-docked notes widget.
//!
//! Rust owns the window geometry, the dock state machine and (from M1) the
//! database, so the webview needs no privileged permissions.

pub mod commands;
pub mod db;
pub mod dock;
pub mod error;
pub mod platform;
pub mod tray;

use std::sync::Arc;

use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use db::{Database, settings};
use dock::{DOCK_WINDOW_LABEL, Dock, Input, Side, Timings, poller};

/// The dock side default (brief 9.2). Settings arrive in M1.
const DEFAULT_SIDE: Side = Side::Right;
/// Vertically centred on the work area (brief 9.2 `dock.tabOffset`).
const DEFAULT_TAB_OFFSET: f64 = 0.5;

/// Brief 6.11: one global shortcut, opening the panel with a new note ready to
/// type into. The accelerator is a setting, so a user who has taken
/// `CmdOrCtrl+Alt+N` for something else can move it.
fn register_new_note_shortcut(app: &tauri::AppHandle) {
    let accelerator = app
        .try_state::<Database>()
        .and_then(|db| db.with(settings::get).ok())
        .map_or_else(
            || db::Settings::default().shortcut_new_note,
            |settings| settings.shortcut_new_note,
        );

    let result =
        app.global_shortcut()
            .on_shortcut(accelerator.as_str(), |app, _shortcut, event| {
                // Both press and release arrive; acting on each would open two notes.
                if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    tray::open_with_new_note(app);
                }
            });

    if let Err(error) = result {
        // A shortcut another app already owns must not stop the widget from
        // starting: everything else still works without it.
        log::error!("shortcut: could not register {accelerator}: {error}");
    }
}

pub fn run() {
    let builder = tauri::Builder::default()
        // Single instance must be registered first: a second launch has to be
        // turned away before it starts building windows or opening the database.
        // Rather than start over, it shows the panel that is already running.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            log::info!("a second instance was launched; showing the running panel");
            tray::show_panel(app);
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            // A LaunchAgent rather than a login item, so the widget comes back
            // after a restart without appearing in the user's Login Items list.
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    builder
        .invoke_handler(tauri::generate_handler![
            commands::app_ready,
            commands::dock_set_keep_open,
            commands::dock_set_interaction_lock,
            commands::dock_animation_done,
            commands::dock_toggle,
            commands::dock_pointer_left,
            commands::notes_list,
            commands::notes_create,
            commands::notes_update,
            commands::notes_delete,
            commands::notes_restore,
            commands::settings_get,
            commands::settings_update,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            platform::macos::set_activation_policy(app);

            let handle = app.handle().clone();

            // Rust owns the database; the webview never sees a path or SQL.
            let data_dir = handle.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let database = Database::open(&data_dir.join("notes.db"))?;
            // Brief 9.1: drop notes soft-deleted more than 30 days ago.
            match database.purge_expired() {
                Ok(0) => {}
                Ok(count) => log::info!("db: purged {count} expired notes"),
                Err(error) => log::error!("db: purge failed: {error}"),
            }
            let dock_side = database
                .with(db::settings::get)
                .map_or(DEFAULT_SIDE, |settings| settings.dock_side);
            let tab_offset = database
                .with(db::settings::get)
                .map_or(DEFAULT_TAB_OFFSET, |settings| settings.dock_tab_offset);
            app.manage(database);

            let window = handle
                .get_webview_window(DOCK_WINDOW_LABEL)
                .ok_or("the dock window is missing from tauri.conf.json")?;

            // NSPanel conversion must happen before the window is positioned or shown.
            platform::configure(&window);

            let geometry = poller::geometry_for(&handle, dock_side, tab_offset);
            app.manage(Arc::new(Dock::new(geometry, Timings::default())));

            // Brief 6.3: another app taking focus starts the close delay.
            let event_handle = handle.clone();
            window.on_window_event(move |event| {
                let Some(dock) = event_handle.try_state::<Arc<Dock>>() else {
                    return;
                };
                match event {
                    WindowEvent::Focused(false) => {
                        dock.input(&event_handle, Input::WindowBlurred);
                    }
                    WindowEvent::Destroyed => dock.stop(),
                    _ => {}
                }
            });

            tray::init(&handle)?;
            register_new_note_shortcut(&handle);

            poller::spawn(handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| panic!("failed to start Edge Notes: {error}"));
}
