//! Linux: Wayland cannot position its own windows and GNOME ignores
//! always-on-top, so by default the app runs under XWayland (brief 8.10).
//!
//! **Native Wayland docking (idea 9)** is the exception, opt-in and
//! experimental. On a compositor with the layer-shell protocol (KDE Plasma,
//! Sway, Hyprland, COSMIC — not GNOME), the window becomes a layer surface
//! anchored to the docked edge by the compositor itself, in the overlay layer
//! above full-screen apps. gtk-layer-shell is loaded at runtime, so a machine
//! without it simply stays on XWayland. It is turned on by a marker file
//! (Settings writes it) because the choice has to be made at the very top of
//! `main`, long before the settings database can be opened.

use std::ffi::{c_char, c_int, c_void};
use std::path::PathBuf;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::WebviewWindow;

use crate::dock::{Rect, Side};

/// Whether this run is a layer surface on native Wayland.
static LAYER_SHELL: AtomicBool = AtomicBool::new(false);

const LIBRARY: &str = "libgtk-layer-shell.so.0";
const MARKER: &str = "wayland-layer-shell";

// gtk-layer-shell's enums, from its public header.
const EDGE_LEFT: c_int = 0;
const EDGE_RIGHT: c_int = 1;
const EDGE_TOP: c_int = 2;
const EDGE_BOTTOM: c_int = 3;
const LAYER_OVERLAY: c_int = 3;
const KEYBOARD_ON_DEMAND: c_int = 2;

pub fn configure(window: &WebviewWindow) {
    if layer_shell_active() && !init_layer_surface(window) {
        // The compositor said no after all. The window is a plain Wayland one
        // that cannot place itself, so undo the opt-in: the next launch is back
        // on XWayland, where it works.
        LAYER_SHELL.store(false, Ordering::SeqCst);
        set_layer_shell_requested(false);
    }
}

/// Decide the GDK backend before Tauri or GTK start.
///
/// Must run at the very top of `main`, before any threads exist: in Rust 2024
/// `set_var` is unsafe precisely because it races with other threads reading the
/// environment.
pub fn prepare_display_backend() {
    let wayland = is_wayland();
    if wayland && layer_shell_requested() && !is_gnome() && library_present() {
        LAYER_SHELL.store(true, Ordering::SeqCst);
        // Wayland explicitly, over whatever the environment says: an AppImage's
        // GTK hook sets `GDK_BACKEND=x11` before the app runs (tauri#15781),
        // which would silently turn layer shell off.
        // SAFETY: first statement in main, before any thread is spawned.
        unsafe {
            std::env::set_var("GDK_BACKEND", "wayland");
        }
        return;
    }

    let opted_out = std::env::var("LEDGE_NATIVE_WAYLAND").is_ok_and(|value| value == "1");
    if wayland && !opted_out {
        // SAFETY: called as the first statement in main, before any thread is
        // spawned, so nothing else can be reading the environment concurrently.
        unsafe {
            std::env::set_var("GDK_BACKEND", "x11");
        }
    }
}

/// This run is a layer surface: placement is margins, and hover comes from the
/// window's own pointer events.
#[must_use]
pub fn layer_shell_active() -> bool {
    LAYER_SHELL.load(Ordering::SeqCst)
}

/// Whether native docking could be offered at all: a Wayland session on a
/// desktop other than GNOME, which has no layer shell.
#[must_use]
pub fn layer_shell_possible() -> bool {
    is_wayland() && !is_gnome()
}

/// The opt-in: the marker file exists, or `LEDGE_LAYER_SHELL=1` for trying it
/// from a terminal.
#[must_use]
pub fn layer_shell_requested() -> bool {
    std::env::var("LEDGE_LAYER_SHELL").is_ok_and(|value| value == "1")
        || marker().is_some_and(|path| path.exists())
}

/// Write or remove the marker. Applies from the next launch.
pub fn set_layer_shell_requested(enabled: bool) -> bool {
    let Some(path) = marker() else {
        return false;
    };
    let result = if enabled {
        path.parent()
            .map_or(Ok(()), std::fs::create_dir_all)
            .and_then(|()| std::fs::write(&path, b"Native Wayland docking: remove to turn off.\n"))
    } else {
        match std::fs::remove_file(&path) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
            _ => Ok(()),
        }
    };
    result
        .map_err(|error| log::error!("linux: could not change the layer-shell switch: {error}"))
        .is_ok()
}

/// `$XDG_DATA_HOME/dev.ledge.app/wayland-layer-shell`, which is where Tauri's
/// `app_data_dir()` is on Linux — worked out by hand because Tauri is not
/// running yet when this is first read.
fn marker() -> Option<PathBuf> {
    let data = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
        })?;
    Some(data.join("dev.ledge.app").join(MARKER))
}

fn is_wayland() -> bool {
    std::env::var("XDG_SESSION_TYPE").is_ok_and(|value| value.eq_ignore_ascii_case("wayland"))
}

fn is_gnome() -> bool {
    std::env::var("XDG_CURRENT_DESKTOP")
        .is_ok_and(|value| value.to_ascii_lowercase().contains("gnome"))
}

fn library_present() -> bool {
    layer().is_some()
}

/// The handful of gtk-layer-shell functions the dock needs, loaded once. The
/// library is kept alive for the life of the process, so the function pointers
/// taken from it stay valid.
struct Layer {
    _library: libloading::Library,
    is_supported: unsafe extern "C" fn() -> c_int,
    init_for_window: unsafe extern "C" fn(*mut c_void),
    set_layer: unsafe extern "C" fn(*mut c_void, c_int),
    set_namespace: unsafe extern "C" fn(*mut c_void, *const c_char),
    set_anchor: unsafe extern "C" fn(*mut c_void, c_int, c_int),
    set_margin: unsafe extern "C" fn(*mut c_void, c_int, c_int),
    set_exclusive_zone: unsafe extern "C" fn(*mut c_void, c_int),
    /// 0.6 and later; older versions have only all-or-nothing keyboard
    /// interactivity, which would grab the keyboard, so they go without.
    set_keyboard_mode: Option<unsafe extern "C" fn(*mut c_void, c_int)>,
}

fn layer() -> Option<&'static Layer> {
    static LAYER: OnceLock<Option<Layer>> = OnceLock::new();
    LAYER.get_or_init(load).as_ref()
}

fn load() -> Option<Layer> {
    // SAFETY: loading a system library by its soname; its initialisers are
    // GTK's own. Every symbol is looked up by its documented C name and typed
    // with its documented signature.
    unsafe {
        let library = libloading::Library::new(LIBRARY)
            .map_err(|error| log::info!("linux: {LIBRARY} is not available: {error}"))
            .ok()?;
        let is_supported = *library.get(b"gtk_layer_is_supported\0").ok()?;
        let init_for_window = *library.get(b"gtk_layer_init_for_window\0").ok()?;
        let set_layer = *library.get(b"gtk_layer_set_layer\0").ok()?;
        let set_namespace = *library.get(b"gtk_layer_set_namespace\0").ok()?;
        let set_anchor = *library.get(b"gtk_layer_set_anchor\0").ok()?;
        let set_margin = *library.get(b"gtk_layer_set_margin\0").ok()?;
        let set_exclusive_zone = *library.get(b"gtk_layer_set_exclusive_zone\0").ok()?;
        let set_keyboard_mode = library
            .get(b"gtk_layer_set_keyboard_mode\0")
            .ok()
            .map(|symbol| *symbol);
        Some(Layer {
            _library: library,
            is_supported,
            init_for_window,
            set_layer,
            set_namespace,
            set_anchor,
            set_margin,
            set_exclusive_zone,
            set_keyboard_mode,
        })
    }
}

/// The window's `GtkWindow*`, for the C calls.
fn raw_window(window: &WebviewWindow) -> Option<(gtk::ApplicationWindow, *mut c_void)> {
    use gtk::glib::object::ObjectType;
    let gtk_window = window.gtk_window().ok()?;
    let raw = gtk_window.as_ptr().cast::<c_void>();
    Some((gtk_window, raw))
}

/// Make the (still hidden) dock window a layer surface: overlay layer, keyboard
/// only when clicked into, no reserved space. False if the compositor does not
/// speak the protocol. Must run on the main thread, before the window is shown.
fn init_layer_surface(window: &WebviewWindow) -> bool {
    use gtk::prelude::*;
    let Some(layer) = layer() else {
        return false;
    };
    // SAFETY: a plain query; GTK is initialised by the time `setup` runs.
    if unsafe { (layer.is_supported)() } == 0 {
        log::error!("linux: this compositor has no layer shell; back to XWayland next launch");
        return false;
    }
    let Some((gtk_window, raw)) = raw_window(window) else {
        return false;
    };
    // A layer surface has to be set up before the window is realised; Tauri
    // may already have realised it while building the webview.
    if gtk_window.is_realized() {
        gtk_window.unrealize();
    }
    // SAFETY: `raw` is this window's own GtkWindow, alive for the call, and each
    // function takes exactly these arguments.
    unsafe {
        (layer.init_for_window)(raw);
        (layer.set_layer)(raw, LAYER_OVERLAY);
        (layer.set_namespace)(raw, c"ledge".as_ptr());
        (layer.set_exclusive_zone)(raw, 0);
        if let Some(set_keyboard_mode) = layer.set_keyboard_mode {
            set_keyboard_mode(raw, KEYBOARD_ON_DEMAND);
        }
    }
    log::info!("linux: docked as a Wayland layer surface");
    true
}

/// Put a layer-surface dock where the controller wants it. A layer surface has
/// no position of its own: it is anchored to the docked edge and to the top of
/// the monitor, and the rest is its size and a top margin. Both are double
/// buffered, so the compositor applies them together — none of the X11
/// placement loop is needed. Must run on the main thread.
pub fn place_layer(window: &WebviewWindow, rect: Rect, side: Side, work_area: Rect, scale: f64) {
    use gtk::prelude::*;
    let (Some(layer), Some((gtk_window, raw))) = (layer(), raw_window(window)) else {
        return;
    };
    let logical = |pixels: i32| (f64::from(pixels) / scale.max(0.1)).round() as c_int;
    let width = logical(i32::try_from(rect.width).unwrap_or(i32::MAX));
    let height = logical(i32::try_from(rect.height).unwrap_or(i32::MAX));
    let top = logical(rect.y - work_area.y).max(0);
    let (edge, other) = match side {
        Side::Left => (EDGE_LEFT, EDGE_RIGHT),
        Side::Right => (EDGE_RIGHT, EDGE_LEFT),
    };
    // SAFETY: as in `init_layer_surface`.
    unsafe {
        (layer.set_anchor)(raw, edge, 1);
        (layer.set_anchor)(raw, other, 0);
        (layer.set_anchor)(raw, EDGE_TOP, 1);
        (layer.set_anchor)(raw, EDGE_BOTTOM, 0);
        (layer.set_margin)(raw, edge, 0);
        (layer.set_margin)(raw, EDGE_TOP, top);
    }
    gtk_window.set_size_request(width, height);
    gtk_window.resize(width, height);
}

/// Where the window takes the pointer, in logical pixels from its top-left, or
/// `None` for all of it.
///
/// While the panel is closed the window should be just the tab, but a GTK
/// window that is not resizable is sized by requests, and one that has grown may
/// not shrink back straight away (or at all, under some window managers). Then
/// an invisible, panel-sized block sits over whatever is behind it and eats its
/// clicks and scrolling. Limiting input to the tab makes the rest pass through
/// whatever size the window really is. Works on X11 (the shape extension) and
/// Wayland alike. Must run on the main thread.
pub fn set_input_region(window: &WebviewWindow, region: Option<(f64, f64, f64, f64)>) {
    use gtk::cairo::{RectangleInt, Region};
    use gtk::prelude::*;
    let Ok(gtk_window) = window.gtk_window() else {
        return;
    };
    match region {
        Some((x, y, width, height)) => {
            let shape = Region::create();
            let rect = RectangleInt::new(
                x.floor() as i32,
                y.floor() as i32,
                width.ceil().max(1.0) as i32,
                height.ceil().max(1.0) as i32,
            );
            if let Err(error) = shape.union_rectangle(&rect) {
                log::error!("linux: could not build the input region: {error}");
                return;
            }
            gtk_window.input_shape_combine_region(Some(&shape));
        }
        None => gtk_window.input_shape_combine_region(None),
    }
}
