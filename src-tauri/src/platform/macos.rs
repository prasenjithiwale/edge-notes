//! macOS: NSPanel conversion and activation policy (brief 8.8).
//!
//! Isolated here so `tauri-nspanel` — a pinned community git dependency — can be
//! swapped out without touching the dock logic.

use tauri::{App, Manager, WebviewWindow};
use tauri_nspanel::objc2_app_kit::NSApplication;
use tauri_nspanel::{
    CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt, tauri_panel,
};

use crate::dock::DOCK_WINDOW_LABEL;

tauri_panel! {
    panel!(DockPanel {
        config: {
            // Typing in the editor must work, so the panel can become key.
            can_become_key_window: true,
            can_become_main_window: false,
            // `becomesKeyOnlyIfNeeded` must stay off. It hands key status over
            // only when the click lands on a view AppKit knows needs keys — an
            // NSTextField. The whole webview is a single NSView, so AppKit can
            // never tell that an HTML textarea wants input: with this on, the
            // panel never became key and the editor could not be typed into at
            // all. Hover still takes no focus, because hover is not a click, and
            // `nonactivating_panel` below keeps a click from activating the app.
            becomes_key_only_if_needed: false,
            is_floating_panel: true
        }
    })
}

/// No Dock icon and no menu bar: this is a widget, not an app window.
pub fn set_activation_policy(app: &App) {
    app.handle()
        .set_activation_policy(tauri::ActivationPolicy::Accessory)
        .unwrap_or_else(|error| log::error!("macos: failed to set activation policy: {error}"));
}

/// Convert the dock window into a non-activating floating panel that joins every
/// Space and can sit over full-screen apps.
pub fn configure(window: &WebviewWindow) {
    let panel = match window.to_panel::<DockPanel>() {
        Ok(panel) => panel,
        Err(error) => {
            log::error!("macos: failed to convert window to NSPanel: {error}");
            return;
        }
    };

    panel.set_level(PanelLevel::Floating.value());
    // A nonactivating panel does not activate the app when it is clicked.
    panel.set_style_mask(StyleMask::empty().nonactivating_panel().into());
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .full_screen_auxiliary()
            .can_join_all_spaces()
            .into(),
    );
    // The dock must stay put when the user switches to another app.
    panel.set_hides_on_deactivate(false);
    panel.set_works_when_modal(true);
}

/// Order the panel in front without making it key, so focus stays where it was.
pub fn show(window: &WebviewWindow) {
    match window.app_handle().get_webview_panel(DOCK_WINDOW_LABEL) {
        Ok(panel) => panel.order_front_regardless(),
        Err(error) => {
            log::error!("macos: panel not found, falling back to window show: {error:?}");
            if let Err(error) = window.show() {
                log::error!("macos: failed to show window: {error}");
            }
        }
    }
}

/// Take focus deliberately (global shortcut or tray), which is the only time
/// the dock is allowed to become key.
pub fn focus_panel(window: &WebviewWindow) {
    if let Ok(panel) = window.app_handle().get_webview_panel(DOCK_WINDOW_LABEL) {
        // Orders the panel in and makes it key, but says nothing about which
        // *application* is active.
        panel.show_and_make_key();
    }

    // An Accessory app that is not active cannot hold the keyboard, however key
    // its window claims to be: the shortcut opened the panel and the editor drew a
    // caret, yet every keystroke still went to the app behind it. The panel's
    // `nonactivating` style mask is what makes it so — that mask exists precisely
    // to stop the app being activated — so the app has to be activated by hand.
    // Only the deliberate paths reach here (shortcut, tray); hover never does, so
    // this cannot steal focus from someone working elsewhere.
    activate_app();

    if let Err(error) = window.set_focus() {
        log::error!("macos: failed to focus the panel: {error}");
    }
}

/// Bring the app forward. For an `Accessory` app this adds no Dock icon and no
/// menu bar; it only makes the process the active one, so its key window is the
/// one the keyboard talks to.
fn activate_app() {
    let Some(mtm) = tauri_nspanel::objc2_foundation::MainThreadMarker::new() else {
        // Panel operations already require the main thread (brief 8.8); if we are
        // somehow off it, skip rather than risk an AppKit call from the wrong one.
        log::error!("macos: activation attempted off the main thread");
        return;
    };
    NSApplication::sharedApplication(mtm).activate();
}
