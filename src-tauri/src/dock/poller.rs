//! The single polling thread, and the only place dock actions reach Tauri.
//!
//! macOS does not deliver mouse events to inactive windows (tauri-apps/tauri#11386,
//! still open), and this widget is inactive nearly all the time, so the global
//! cursor position is the source of truth rather than DOM hover.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

use super::controller::{Action, DockController, Input, Phase, Timings};
use super::geometry::{ApplyOrder, DockGeometry, Metrics, Rect, Side, apply_order};

/// Brief 8.5: re-evaluate placement every 2 seconds while collapsed.
const MONITOR_REFRESH: Duration = Duration::from_secs(2);
/// Monitor queries are marshalled to the main thread; don't block the poller forever.
const MAIN_THREAD_TIMEOUT: Duration = Duration::from_millis(500);

pub const DOCK_WINDOW_LABEL: &str = "dock";
pub const DOCK_STATE_EVENT: &str = "dock:state";

/// Shared dock state. Commands and the poller both drive the controller through here.
/// `dock.monitor`'s sentinel for "wherever the primary display is" (brief 9.2).
pub const PRIMARY_MONITOR: &str = "primary";

pub struct Dock {
    controller: Mutex<DockController>,
    stopped: AtomicBool,
}

impl Dock {
    #[must_use]
    pub fn new(geometry: DockGeometry, timings: Timings) -> Self {
        Self {
            controller: Mutex::new(DockController::new(geometry, timings)),
            stopped: AtomicBool::new(false),
        }
    }

    /// Ask the poll thread to finish, so it does not outlive the window it drives.
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Relaxed);
    }

    #[must_use]
    pub fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::Relaxed)
    }

    /// Brief 9.3: the open and close delays apply immediately, without a restart.
    pub fn set_timings(&self, timings: Timings) {
        match self.controller.lock() {
            Ok(mut controller) => controller.set_timings(timings),
            Err(poisoned) => poisoned.into_inner().set_timings(timings),
        }
    }

    /// Feed an input and apply whatever the controller returns.
    pub fn input(&self, app: &AppHandle, input: Input) {
        let actions = match self.controller.lock() {
            Ok(mut controller) => controller.handle(input, Instant::now()),
            Err(poisoned) => poisoned.into_inner().handle(input, Instant::now()),
        };
        apply(app, actions);
    }

    fn tick(&self, app: &AppHandle) -> Duration {
        let (actions, interval) = match self.controller.lock() {
            Ok(mut controller) => {
                let actions = controller.tick(Instant::now());
                (actions, controller.poll_interval())
            }
            Err(poisoned) => {
                let mut controller = poisoned.into_inner();
                let actions = controller.tick(Instant::now());
                (actions, controller.poll_interval())
            }
        };
        apply(app, actions);
        interval
    }

    /// The current phase, so the tray and the shortcut can tell "show the notes"
    /// from "toggle them": summoning the panel deliberately must never hide it.
    #[must_use]
    pub fn phase(&self) -> Phase {
        match self.controller.lock() {
            Ok(controller) => controller.phase(),
            Err(poisoned) => poisoned.into_inner().phase(),
        }
    }

    fn geometry_matches(&self, monitor: &MonitorSnapshot) -> bool {
        let read = |controller: &DockController| {
            let g = controller.geometry();
            g.work_area() == monitor.work_area && (g.scale() - monitor.scale).abs() < f64::EPSILON
        };
        match self.controller.lock() {
            Ok(controller) => read(&controller),
            Err(poisoned) => read(&poisoned.into_inner()),
        }
    }

    /// Rebuild the geometry for a new monitor, scale factor or dock side.
    pub fn set_geometry(&self, app: &AppHandle, geometry: DockGeometry) {
        let actions = match self.controller.lock() {
            Ok(mut controller) => controller.set_geometry(geometry),
            Err(poisoned) => poisoned.into_inner().set_geometry(geometry),
        };
        apply(app, actions);
    }

    /// Rebuild for a new monitor, keeping the side and tab offset.
    pub fn retarget_monitor(&self, app: &AppHandle, monitor: MonitorSnapshot) {
        let geometry = match self.controller.lock() {
            Ok(controller) => controller
                .geometry()
                .with_monitor(monitor.work_area, monitor.scale),
            Err(poisoned) => poisoned
                .into_inner()
                .geometry()
                .with_monitor(monitor.work_area, monitor.scale),
        };
        self.set_geometry(app, geometry);
    }

    #[must_use]
    pub fn side(&self) -> Side {
        match self.controller.lock() {
            Ok(controller) => controller.geometry().side(),
            Err(poisoned) => poisoned.into_inner().geometry().side(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MonitorSnapshot {
    pub work_area: Rect,
    pub scale: f64,
}

/// Query the monitor from the main thread.
///
/// tauri-apps/tauri#15170 (monitor and cursor queries crashing under load) was
/// fixed by PR #15630, but that landed in the 2.12 milestone and the newest
/// published release is 2.11.5. Marshalling monitor queries to the main thread
/// is what the upstream fix does, so we do it here until 2.12 ships.
pub fn monitor_snapshot(app: &AppHandle) -> Option<MonitorSnapshot> {
    monitor_snapshot_for(app, PRIMARY_MONITOR)
}

/// The work area of the monitor the dock should live on.
///
/// `name` is `dock.monitor` (brief 9.2): `"primary"`, or a monitor name. A
/// monitor that has been unplugged falls back to primary rather than leaving the
/// tab on a screen that no longer exists (brief 8.5).
pub fn monitor_snapshot_for(app: &AppHandle, name: &str) -> Option<MonitorSnapshot> {
    let (tx, rx) = mpsc::channel();
    let handle = app.clone();
    let wanted = name.to_owned();
    if app
        .run_on_main_thread(move || {
            let chosen = if wanted == PRIMARY_MONITOR {
                None
            } else {
                handle.available_monitors().ok().and_then(|monitors| {
                    monitors
                        .into_iter()
                        .find(|monitor| monitor.name().is_some_and(|n| *n == wanted))
                })
            };
            let snapshot = chosen
                .or_else(|| handle.primary_monitor().ok().flatten())
                .or_else(|| {
                    handle
                        .available_monitors()
                        .ok()
                        .and_then(|m| m.into_iter().next())
                })
                .map(|monitor| {
                    let area = monitor.work_area();
                    MonitorSnapshot {
                        work_area: Rect::new(
                            area.position.x,
                            area.position.y,
                            area.size.width,
                            area.size.height,
                        ),
                        scale: monitor.scale_factor(),
                    }
                });
            let _ = tx.send(snapshot);
        })
        .is_err()
    {
        return None;
    }
    rx.recv_timeout(MAIN_THREAD_TIMEOUT).ok().flatten()
}

/// Build the geometry for the current monitor, falling back to a sane default
/// if no monitor can be read (brief 8.5: fall back to primary).
#[must_use]
/// Everything from the settings table that decides where the dock sits and how
/// big it is. Grouped so adding the next placement setting does not change every
/// call site (brief 9.2).
#[derive(Debug, Clone, PartialEq)]
pub struct Placement {
    pub side: Side,
    pub tab_offset: f64,
    pub panel_width: f64,
    pub monitor: String,
}

impl Default for Placement {
    fn default() -> Self {
        Self {
            side: Side::Right,
            tab_offset: 0.5,
            panel_width: Metrics::default().panel_width,
            monitor: PRIMARY_MONITOR.to_owned(),
        }
    }
}

pub fn geometry_for(app: &AppHandle, placement: &Placement) -> DockGeometry {
    let snapshot = monitor_snapshot_for(app, &placement.monitor).unwrap_or(MonitorSnapshot {
        work_area: Rect::new(0, 0, 1440, 900),
        scale: 1.0,
    });
    DockGeometry::new(
        snapshot.work_area,
        snapshot.scale,
        placement.side,
        placement.tab_offset,
        Metrics {
            panel_width: placement.panel_width,
            ..Metrics::default()
        },
    )
}

fn apply(app: &AppHandle, actions: Vec<Action>) {
    for action in actions {
        match action {
            Action::SetWindowRect(rect) => apply_rect(app, rect),
            Action::EmitState(state) => {
                if let Some(window) = app.get_webview_window(DOCK_WINDOW_LABEL)
                    && let Err(error) = window.emit_to(DOCK_WINDOW_LABEL, DOCK_STATE_EVENT, state)
                {
                    log::error!("dock: failed to emit state: {error}");
                }
            }
            Action::Focus => focus_on_main_thread(app),
        }
    }
}

/// Taking focus touches the panel, and panel operations belong on the main
/// thread (brief 8.8). Actions are applied from whatever thread fed the
/// controller — the poll thread, a command, the global shortcut, or the
/// single-instance listener — and an AppKit call from the wrong one throws an
/// Objective-C exception that Rust cannot catch: a second launch aborted the
/// running app outright.
fn focus_on_main_thread(app: &AppHandle) {
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window(DOCK_WINDOW_LABEL) {
            focus(&window);
        }
    }) {
        log::error!("dock: failed to schedule focus: {error}");
    }
}

#[cfg(target_os = "macos")]
fn focus(window: &WebviewWindow) {
    crate::platform::macos::focus_panel(window);
}

#[cfg(not(target_os = "macos"))]
fn focus(window: &WebviewWindow) {
    if let Err(error) = window.set_focus() {
        log::error!("dock: failed to focus: {error}");
    }
}

/// Move and resize the window.
///
/// Tauri 2.11 has no atomic bounds API, so this is two calls. Both are issued
/// inside one main-thread closure so they land in the same run-loop turn and the
/// compositor presents a single update. If a jump ever shows up on macOS, the
/// next step is `NSPanel::setFrame_display_` through the panel handle.
fn apply_rect(app: &AppHandle, rect: Rect) {
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        let Some(window) = handle.get_webview_window(DOCK_WINDOW_LABEL) else {
            return;
        };
        let current = current_rect(&window).unwrap_or(rect);
        let position = PhysicalPosition::new(rect.x, rect.y);
        let size = PhysicalSize::new(rect.width, rect.height);

        match apply_order(current, rect) {
            // Growing: move first so a stray frame shows the window on screen.
            ApplyOrder::MoveThenResize => {
                set_position(&window, position);
                set_size(&window, size);
            }
            // Shrinking: resize first for the same reason.
            ApplyOrder::ResizeThenMove => {
                set_size(&window, size);
                set_position(&window, position);
            }
        }
    }) {
        log::error!("dock: failed to schedule window update: {error}");
    }
}

fn set_position(window: &WebviewWindow, position: PhysicalPosition<i32>) {
    if let Err(error) = window.set_position(position) {
        log::error!("dock: failed to set position: {error}");
    }
}

fn set_size(window: &WebviewWindow, size: PhysicalSize<u32>) {
    if let Err(error) = window.set_size(size) {
        log::error!("dock: failed to set size: {error}");
    }
}

fn current_rect(window: &WebviewWindow) -> Option<Rect> {
    let position = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    Some(Rect::new(position.x, position.y, size.width, size.height))
}

/// Start the one and only polling thread.
pub fn spawn(app: AppHandle) {
    std::thread::Builder::new()
        .name("dock-poller".into())
        .spawn(move || {
            let mut next_monitor_check = Instant::now() + MONITOR_REFRESH;
            loop {
                let Some(dock) = app.try_state::<std::sync::Arc<Dock>>() else {
                    return;
                };
                let dock = dock.inner().clone();
                if dock.is_stopped() {
                    return;
                }

                // Brief 8.5: only while collapsed, so an open panel is never
                // repositioned under the cursor.
                if Instant::now() >= next_monitor_check {
                    next_monitor_check = Instant::now() + MONITOR_REFRESH;
                    if dock.phase() == Phase::Collapsed
                        && let Some(snapshot) = monitor_snapshot(&app)
                        && !dock.geometry_matches(&snapshot)
                    {
                        dock.retarget_monitor(&app, snapshot);
                    }
                }

                if let Ok(position) = app.cursor_position() {
                    dock.input(
                        &app,
                        Input::Cursor {
                            x: position.x,
                            y: position.y,
                        },
                    );
                }

                let interval = dock.tick(&app);
                std::thread::sleep(interval);
            }
        })
        .map_or_else(
            |error| log::error!("dock: failed to start poller: {error}"),
            |_| (),
        );
}
