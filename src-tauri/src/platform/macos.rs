//! macOS: NSPanel conversion and activation policy (brief 8.8).
//!
//! Isolated here so `tauri-nspanel` — a pinned community git dependency — can be
//! swapped out without touching the dock logic.

use std::time::Duration;

use tauri::{App, Manager, WebviewWindow};
// `NSPoint`, `NSRect` and `NSSize` are spelled out where they are used: the
// `tauri_panel!` macro below imports them into this module itself.
use tauri_nspanel::{
    CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt, tauri_panel,
};

use crate::dock::{DOCK_WINDOW_LABEL, Rect};

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
    let Ok(panel) = window.app_handle().get_webview_panel(DOCK_WINDOW_LABEL) else {
        log::error!("macos: panel not found, cannot take focus");
        return;
    };
    // This makes the panel the key window, but on macOS that is not enough for it
    // to actually receive keystrokes — see the M3 notes in docs/progress.md for
    // the gap and everything that has been ruled out. Activating the app,
    // dropping the `nonactivating` style mask and switching the activation policy
    // were all tried and none of them delivered a keystroke, so none of them are
    // carried here.
    panel.show_and_make_key();
}

/// Move and resize the panel in one window-server transaction.
///
/// Tauri 2.11 has no atomic bounds API, and on macOS the two calls it does have
/// are not even applied in the same run-loop turn: tao's `set_outer_position`
/// and `set_inner_size` each `dispatch_async` their own block onto the main
/// queue (`set_frame_top_left_point_async`, `set_content_size_async`), so
/// issuing them back to back inside one `run_on_main_thread` closure still
/// reaches the window server as two separate changes.
///
/// Opening a right dock moves the window a panel's width inwards before it
/// grows, and the webview's last painted frame — the collapsed tab, drawn at the
/// window's top-left — is what the window server has to show at the new origin.
/// The tab appears to jump into the middle of the screen for a frame or two
/// before the panel arrives. `setFrame:display:` carries the origin and the size
/// together, so that intermediate state never exists.
///
/// The target is in tao's coordinates (physical pixels, y down from the primary
/// monitor's top-left) and Cocoa's are logical points with y up from the bottom
/// left, so the move is expressed as a delta from the window's current frame:
/// the flip constant cancels, and this cannot disagree with whatever tao would
/// have computed.
///
/// One transaction is not the whole story: the window server presents the new
/// frame with whatever the webview last painted, so a window that has just
/// grown is shown with the collapsed tab's pixels in its top-left corner for a
/// frame while the web process lays out the new size. `cover` hides the panel
/// across a resize for exactly that long — see `reveal_after_resize`.
///
/// False means the frame could not be set — the caller falls back to the two
/// calls rather than leaving the window where it was.
pub fn set_frame(window: &WebviewWindow, rect: Rect, cover: bool) -> bool {
    let Ok(panel) = window.app_handle().get_webview_panel(DOCK_WINDOW_LABEL) else {
        log::error!("macos: panel not found, cannot set the frame");
        return false;
    };
    let (Ok(position), Ok(size), Ok(scale)) = (
        window.outer_position(),
        window.outer_size(),
        window.scale_factor(),
    ) else {
        log::error!("macos: could not read the window geometry");
        return false;
    };
    if scale <= 0.0 {
        return false;
    }

    // Only a resize can show pixels the webview painted for a different
    // window; a move carries content that is still right for the one it has.
    let resized = rect.width != size.width || rect.height != size.height;
    panel.set_alpha_value(if cover && resized && reveal_after_resize(window) {
        0.0
    } else {
        // Also the repair for a reveal that never arrived: an invisible widget
        // is worse than a visible seam, so every placement puts the panel back.
        1.0
    });

    let frame = panel.as_panel().frame();
    let dx = (f64::from(rect.x) - f64::from(position.x)) / scale;
    // A Cocoa origin is the bottom-left corner, so the window moves up by
    // whatever its bottom edge moves up in tao's downward coordinates.
    let bottom = f64::from(position.y) + f64::from(size.height);
    let target_bottom = f64::from(rect.y) + f64::from(rect.height);
    let dy = (bottom - target_bottom) / scale;

    panel.as_panel().setFrame_display(
        tauri_nspanel::NSRect::new(
            tauri_nspanel::NSPoint::new(frame.origin.x + dx, frame.origin.y + dy),
            tauri_nspanel::NSSize::new(
                f64::from(rect.width) / scale,
                f64::from(rect.height) / scale,
            ),
        ),
        true,
    );
    true
}

/// How long the panel stays invisible while the webview catches up with a
/// window that has just been resized.
///
/// Measured here on a 75 Hz display (13.3 ms a frame): one frame of the
/// collapsed tab, drawn at the expanded window's top-left corner, is what the
/// window server has to show while the web process lays out the new size. Two
/// frames of cover is enough at 60 Hz and two and a half here, and it is short
/// enough that the panel behind it has barely started to slide.
const REVEAL_DELAY: Duration = Duration::from_millis(33);

/// Put the panel back on screen once the webview has had time to paint.
///
/// The thread is started *before* the panel is hidden and hiding is skipped if
/// it could not start, because the tab is the whole of this app's UI while it is
/// collapsed: a cover that is never lifted is an app that has vanished.
fn reveal_after_resize(window: &WebviewWindow) -> bool {
    let app = window.app_handle().clone();
    std::thread::Builder::new()
        .name("dock-reveal".into())
        .spawn(move || {
            std::thread::sleep(REVEAL_DELAY);
            let handle = app.clone();
            if let Err(error) =
                app.run_on_main_thread(move || match handle.get_webview_panel(DOCK_WINDOW_LABEL) {
                    Ok(panel) => panel.set_alpha_value(1.0),
                    Err(error) => {
                        log::error!("macos: panel not found, cannot reveal it: {error:?}")
                    }
                })
            {
                log::error!("macos: failed to schedule the reveal: {error}");
            }
        })
        .map_err(|error| log::error!("macos: failed to start the reveal: {error}"))
        .is_ok()
}

/// macOS's own share sheet: the list of apps the system keeps, anchored to the
/// panel (`NSSharingServicePicker`).
///
/// The items are what the receiving apps actually want — the note's text, plus
/// the files of any pictures in it. Notes, Mail and Messages all take that
/// pairing; handing them a blob of HTML instead would put tags in a message.
///
/// The caller holds the panel open while this is up (`Input::SetModal`): the
/// picker takes focus, and a blur with the cursor elsewhere is how the panel
/// decides everyone has left.
///
/// Returns false if the window is not there to anchor to, so the caller can say
/// so instead of appearing to have done something.
pub fn share_sheet(window: &WebviewWindow, text: &str, files: &[std::path::PathBuf]) -> bool {
    use objc2::AllocAnyThread;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSSharingServicePicker, NSView};
    use objc2_foundation::{NSArray, NSPoint, NSRect, NSRectEdge, NSSize, NSString, NSURL};

    let Ok(view) = window.ns_view() else {
        log::error!("macos: no view to anchor the share sheet to");
        return false;
    };
    if view.is_null() {
        return false;
    }

    let mut items: Vec<Retained<AnyObject>> = Vec::new();
    if !text.trim().is_empty() {
        let string = NSString::from_str(text);
        items.push(unsafe { Retained::cast_unchecked(string) });
    }
    for file in files {
        let Some(path) = file.to_str() else {
            continue;
        };
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        items.push(unsafe { Retained::cast_unchecked(url) });
    }
    if items.is_empty() {
        return false;
    }

    // SAFETY: the view pointer is the window's own, this runs on the main
    // thread (the caller marshals it), and the items are all objects the picker
    // is documented to take.
    unsafe {
        let view: &NSView = &*view.cast::<NSView>();
        let array = NSArray::from_retained_slice(&items);
        let picker = NSSharingServicePicker::initWithItems(NSSharingServicePicker::alloc(), &array);
        // Anchored to the panel's leading edge rather than to a control: the
        // button that opened it is a webview pixel, not a view AppKit knows.
        let bounds = view.bounds();
        let anchor = NSRect::new(
            NSPoint::new(bounds.origin.x, bounds.origin.y),
            NSSize::new(bounds.size.width.min(8.0), bounds.size.height),
        );
        picker.showRelativeToRect_ofView_preferredEdge(anchor, view, NSRectEdge::MinX);
    }
    true
}

/// The menu-bar countdown, in red, with a soft glow behind it.
///
/// Tauri's tray takes a plain string and keeps its `NSStatusItem` private, so
/// the colour cannot come from `set_title`. What can be coloured is the status
/// bar's own button, through an attributed title — and the button is reachable
/// without any private API: the status item owns a window whose content view
/// *is* that button, and `NSApp.windows` lists it.
///
/// `None` clears it. Returns false when the button could not be found, so the
/// caller can fall back to the plain title rather than showing nothing.
///
/// Must run on the main thread; the caller marshals.
#[must_use]
pub fn set_tray_countdown(text: Option<&str>) -> bool {
    use objc2::rc::Retained;
    use objc2_app_kit::{
        NSApplication, NSColor, NSFont, NSFontAttributeName, NSForegroundColorAttributeName,
        NSShadow, NSShadowAttributeName,
    };
    use objc2_foundation::{MainThreadMarker, NSAttributedString, NSDictionary, NSSize, NSString};

    let Some(mtm) = MainThreadMarker::new() else {
        return false;
    };
    let app = NSApplication::sharedApplication(mtm);

    let mut found = false;
    for window in app.windows() {
        let Some(view) = window.contentView() else {
            continue;
        };
        // The status item's window holds an `NSStatusBarContentView`, and the
        // button is inside *that* — the content view itself is not the button,
        // which is what the first attempt assumed and why the countdown came
        // out in the menu bar's own colour.
        let Some(button) = find_status_button(&view, 3) else {
            continue;
        };
        found = true;

        let Some(text) = text else {
            // An empty attributed string rather than a nil one: the button keeps
            // whatever it was last given, so clearing has to say so.
            button.setAttributedTitle(&NSAttributedString::new());
            continue;
        };

        // The same red as the light on the collapsed tab: the system's own, so
        // it stays legible on a light menu bar and a dark one.
        let glow = NSShadow::new();
        glow.setShadowColor(Some(&NSColor::systemRedColor()));
        glow.setShadowBlurRadius(3.0);
        glow.setShadowOffset(NSSize::new(0.0, 0.0));

        // The menu bar's own font at its own size, so the countdown sits on the
        // same baseline as everything beside it.
        let font = NSFont::menuBarFontOfSize(0.0);
        let keys: [&objc2_foundation::NSString; 3] = [
            unsafe { NSForegroundColorAttributeName },
            unsafe { NSFontAttributeName },
            unsafe { NSShadowAttributeName },
        ];
        let values: [&objc2::runtime::AnyObject; 3] = [
            unsafe { &*Retained::as_ptr(&NSColor::systemRedColor()).cast() },
            unsafe { &*Retained::as_ptr(&font).cast() },
            unsafe { &*Retained::as_ptr(&glow).cast() },
        ];
        let attributes = NSDictionary::from_slices(&keys, &values);
        // SAFETY: the keys are AppKit's own attribute names and each value is
        // the type that key is documented to take.
        let title = unsafe {
            NSAttributedString::new_with_attributes(&NSString::from_str(text), &attributes)
        };
        button.setAttributedTitle(&title);
    }
    found
}

/// The status bar's button, somewhere under `view`.
///
/// Depth-limited rather than unbounded: it is two levels down in every macOS
/// this has been seen on, and a view tree is not something to walk for ever on
/// a timer that ticks once a second.
#[cfg(target_os = "macos")]
fn find_status_button(
    view: &objc2_app_kit::NSView,
    depth: usize,
) -> Option<objc2::rc::Retained<objc2_app_kit::NSStatusBarButton>> {
    use objc2_app_kit::NSStatusBarButton;

    if let Some(button) = view.downcast_ref::<NSStatusBarButton>() {
        return Some(button.retain());
    }
    if depth == 0 {
        return None;
    }
    view.subviews()
        .iter()
        .find_map(|child| find_status_button(&child, depth - 1))
}
