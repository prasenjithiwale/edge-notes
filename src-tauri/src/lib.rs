//! Edge Notes: an edge-docked notes widget.
//!
//! Rust owns the window geometry, the dock state machine and (from M1) the
//! database, so the webview needs no privileged permissions.

pub mod commands;
pub mod db;
pub mod dock;
pub mod error;
pub mod platform;

use std::sync::Arc;

use tauri::{Manager, WindowEvent};

use db::Database;
use dock::{DOCK_WINDOW_LABEL, Dock, Input, Side, Timings, poller};

/// The dock side default (brief 9.2). Settings arrive in M1.
const DEFAULT_SIDE: Side = Side::Right;
/// Vertically centred on the work area (brief 9.2 `dock.tabOffset`).
const DEFAULT_TAB_OFFSET: f64 = 0.5;

pub fn run() {
    let builder = tauri::Builder::default();

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
                Ok(count) => eprintln!("db: purged {count} expired notes"),
                Err(error) => eprintln!("db: purge failed: {error}"),
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

            poller::spawn(handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| panic!("failed to start Edge Notes: {error}"));
}
