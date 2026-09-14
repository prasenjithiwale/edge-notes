//! Edge Notes: an edge-docked notes widget.
//!
//! Rust owns the window geometry, the dock state machine and (from M1) the
//! database, so the webview needs no privileged permissions.

pub mod commands;
pub mod db;
pub mod dock;
pub mod error;
pub mod export;
pub mod links;
pub mod platform;
pub mod reminders;
pub mod tray;

use std::sync::Arc;

use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

use db::Database;
use dock::{DOCK_WINDOW_LABEL, Dock, Input, poller};

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
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    builder
        .invoke_handler(tauri::generate_handler![
            commands::app_ready,
            commands::app_quit,
            commands::dock_set_keep_open,
            commands::dock_set_interaction_lock,
            commands::dock_animation_done,
            commands::dock_toggle,
            commands::dock_pointer_left,
            commands::dock_begin_tab_drag,
            commands::dock_end_tab_drag,
            commands::dock_set_large,
            commands::notes_list,
            commands::notes_create,
            commands::notes_update,
            commands::notes_set_pinned,
            commands::notes_delete,
            commands::notes_restore,
            commands::notes_export,
            commands::open_url,
            commands::reminders_set,
            commands::monitors_list,
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
            let stored = database.with(db::settings::get).unwrap_or_default();
            let placement = stored.placement();
            let timings = stored.timings();
            app.manage(database);

            // Task reminders run on their own thread; the frontend sends the list.
            let reminders = reminders::Reminders::new(stored.tasks_reminders);
            reminders.spawn(handle.clone());
            app.manage(reminders);

            let window = handle
                .get_webview_window(DOCK_WINDOW_LABEL)
                .ok_or("the dock window is missing from tauri.conf.json")?;

            // NSPanel conversion must happen before the window is positioned or shown.
            platform::configure(&window);

            let geometry = poller::geometry_for(&handle, &placement);
            app.manage(Arc::new(Dock::new(geometry, timings)));

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
                    WindowEvent::Destroyed => {
                        dock.stop();
                        if let Some(reminders) =
                            event_handle.try_state::<Arc<reminders::Reminders>>()
                        {
                            reminders.stop();
                        }
                    }
                    _ => {}
                }
            });

            tray::init(&handle)?;
            tray::bind_new_note_shortcut(&handle, None);

            poller::spawn(handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| panic!("failed to start Edge Notes: {error}"));
}
