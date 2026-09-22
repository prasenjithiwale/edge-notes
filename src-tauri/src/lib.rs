//! Ledge: an edge-docked notes widget.
//!
//! Rust owns the window geometry, the dock state machine and (from M1) the
//! database, so the webview needs no privileged permissions.

pub mod commands;
pub mod db;
pub mod dock;
pub mod error;
pub mod export;
pub mod images;
pub mod links;
pub mod platform;
pub mod reminders;
pub mod share;
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
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    builder
        // The one way the webview sees an image: a name this module wrote,
        // checked again on the way out, joined to a folder Rust chose. There is
        // no filesystem permission anywhere near it.
        .register_uri_scheme_protocol(images::SCHEME, |ctx, request| {
            let name = request.uri().path().trim_start_matches('/');
            match images::read(ctx.app_handle(), name) {
                Some((bytes, mime)) => tauri::http::Response::builder()
                    .header(tauri::http::header::CONTENT_TYPE, mime)
                    // The bytes never change under a name: it is a fresh uuid
                    // every time one is written.
                    .header(tauri::http::header::CACHE_CONTROL, "max-age=31536000")
                    .body(bytes)
                    .unwrap_or_else(|_| tauri::http::Response::new(Vec::new())),
                None => tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::NOT_FOUND)
                    .body(Vec::new())
                    .unwrap_or_else(|_| tauri::http::Response::new(Vec::new())),
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_ready,
            commands::quick_capture_prefill,
            commands::quick_capture_close,
            commands::security_status,
            commands::security_recovery_key,
            commands::security_unlock,
            commands::security_start_fresh,
            commands::app_quit,
            commands::dock_set_keep_open,
            commands::dock_set_interaction_lock,
            commands::dock_set_modal,
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
            commands::images_save,
            commands::share_copy_rich,
            commands::share_copy_text,
            commands::share_sheet,
            commands::share_sheet_supported,
            commands::notes_reorder,
            commands::notes_delete,
            commands::notes_restore,
            commands::archive_list,
            commands::archive_purge,
            commands::tasks_list,
            commands::tasks_create,
            commands::tasks_update,
            commands::tasks_set_status,
            commands::tasks_delete,
            commands::tasks_restore,
            commands::notes_export,
            commands::open_url,
            commands::reminders_set,
            commands::app_info,
            commands::monitors_list,
            commands::settings_get,
            commands::settings_update,
            commands::shortcut_set,
            commands::autostart_get,
            commands::autostart_set,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            platform::macos::set_activation_policy(app);

            let handle = app.handle().clone();

            // Rust owns the database; the webview never sees a path or SQL.
            let data_dir = handle.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let database_path = data_dir.join("notes.db");

            // The app was renamed from Edge Notes to Ledge in 0.1.0, and the
            // folder above is named after the bundle identifier, so an install
            // upgrading from 0.0.x arrives here pointing at an empty directory.
            // Copy the old database across once (see `db::adopt`).
            if let Some(base) = data_dir.parent() {
                let previous = base.join(db::adopt::PREVIOUS_IDENTIFIER).join("notes.db");
                match db::adopt::adopt_database(&previous, &database_path) {
                    Ok(true) => log::info!("db: adopted the database from {}", previous.display()),
                    Ok(false) => {}
                    // Not fatal: the app still starts, on an empty database, and
                    // the old folder is untouched for a second attempt.
                    Err(error) => log::error!("db: could not adopt the previous database: {error}"),
                }
            }

            let (database, vault) = Database::open(&database_path)?;
            match vault.protection {
                db::Protection::On => log::info!("db: the notes are encrypted"),
                db::Protection::Unavailable => {
                    log::warn!("db: the notes are NOT encrypted: {}", vault.detail)
                }
                db::Protection::Locked => {
                    log::warn!("db: the notes are locked: {}", vault.detail);
                }
            }
            // Brief 9.1: drop notes soft-deleted more than 30 days ago.
            match database.purge_expired() {
                Ok(0) => {}
                Ok(count) => log::info!("db: purged {count} expired notes"),
                Err(error) => log::error!("db: purge failed: {error}"),
            }
            // And the images no note mentions any more (idea 17). After the
            // purge, so a note that has just gone for good takes its pictures
            // with it, and only at startup: it is the one moment when every note
            // can be read at once and nothing is being typed.
            match database.with(|connection| images::sweep(&handle, connection)) {
                Ok(0) => {}
                Ok(count) => log::info!("images: removed {count} unused files"),
                Err(error) => log::error!("images: sweep failed: {error}"),
            }
            let stored = database.with(db::settings::get).unwrap_or_default();
            let placement = stored.placement();
            let timings = stored.timings();
            app.manage(database);
            app.manage(commands::Vault::new(database_path.clone(), vault));
            app.manage(commands::QuickCapture::default());

            // Task reminders run on their own thread; the frontend sends the list.
            let reminders = reminders::Reminders::new(stored.tasks_reminders);
            reminders.spawn(handle.clone());
            app.manage(reminders);

            let window = handle
                .get_webview_window(DOCK_WINDOW_LABEL)
                .ok_or("the dock window is missing from tauri.conf.json")?;

            // NSPanel conversion must happen before the window is positioned or shown.
            platform::configure(&window);
            // Idea 1: out of screen shares and screenshots unless asked otherwise.
            // Set here rather than in tauri.conf.json because it is a setting,
            // and because it must be applied after the panel conversion.
            platform::set_hidden_from_capture(&window, stored.privacy_hide_from_capture);

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
                    // Idea 17: a picture dropped onto the panel. The paths come
                    // from the window server, and Rust reads them — the webview
                    // is only ever told the names of what was stored, which is
                    // all it can do anything with anyway.
                    WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) => {
                        let names: Vec<String> = paths
                            .iter()
                            .filter_map(|path| match images::import(&event_handle, path) {
                                Ok(name) => Some(name),
                                Err(error) => {
                                    log::warn!(
                                        "images: {} was not stored: {error}",
                                        path.display()
                                    );
                                    None
                                }
                            })
                            .collect();
                        if !names.is_empty() {
                            if let Err(error) =
                                tauri::Emitter::emit(&event_handle, "images:dropped", &names)
                            {
                                log::error!("images: could not announce the drop: {error}");
                            }
                        }
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
            tray::bind_shortcuts(&handle);

            poller::spawn(handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| panic!("failed to start Ledge: {error}"));
}
