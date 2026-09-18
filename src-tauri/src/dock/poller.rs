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
use super::geometry::{ApplyOrder, DockGeometry, Metrics, Rect, Side, apply_order, rect_settled};

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

    /// Where the tab sits along the edge, so a finished drag can be persisted.
    #[must_use]
    pub fn tab_offset(&self) -> f64 {
        match self.controller.lock() {
            Ok(controller) => controller.geometry().tab_offset(),
            Err(poisoned) => poisoned.into_inner().geometry().tab_offset(),
        }
    }

    /// Where the window should be right now, for checking where it actually is.
    #[must_use]
    pub fn expected_window_rect(&self) -> Rect {
        match self.controller.lock() {
            Ok(controller) => controller.rect_for_phase(),
            Err(poisoned) => poisoned.into_inner().rect_for_phase(),
        }
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
    /// What the default tab metrics are multiplied by (`tab.size`).
    pub tab_scale: f64,
    pub monitor: String,
}

impl Default for Placement {
    fn default() -> Self {
        Self {
            side: Side::Right,
            tab_offset: 0.5,
            panel_width: Metrics::default().panel_width,
            tab_scale: 1.0,
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
            // The window and the hit area grow with the pill the frontend
            // paints inside them, so a bigger tab is genuinely easier to hit
            // rather than just easier to see.
            tab_width: Metrics::default().tab_width * placement.tab_scale,
            tab_height: Metrics::default().tab_height * placement.tab_scale,
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
/// Linux takes its own path (`settle_rect`): there a move and a resize are
/// separate asynchronous requests, and the window manager may adjust either.
#[cfg(target_os = "linux")]
fn apply_rect(app: &AppHandle, rect: Rect) {
    spawn_settle(app, rect);
}

/// Move and resize the window.
///
/// macOS sets the frame in one go through the panel handle, because its two
/// calls are applied in separate run-loop turns and the moved-but-not-yet-grown
/// window is a frame the user can see (`platform::macos::set_frame`).
///
/// Everywhere else Tauri 2.11 has no atomic bounds API, so this is two calls.
/// Both are issued inside one main-thread closure so they land in the same
/// run-loop turn and the compositor has the chance to present a single update.
#[cfg(not(target_os = "linux"))]
fn apply_rect(app: &AppHandle, rect: Rect) {
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        let Some(window) = handle.get_webview_window(DOCK_WINDOW_LABEL) else {
            return;
        };
        #[cfg(target_os = "macos")]
        {
            // A window collapsing back to the tab is the one resize that needs
            // no cover: the panel has already slid out, so the pixels the
            // webview painted last are the panel's empty margin, and hiding the
            // tab for two frames would blink the only thing always on screen.
            let cover = handle
                .try_state::<std::sync::Arc<Dock>>()
                .is_some_and(|dock| dock.phase().is_expanded());
            if crate::platform::macos::set_frame(&window, rect, cover) {
                return;
            }
        }
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

// ---------------------------------------------------------------------------
// Linux: place the window, then check that it stayed placed
// ---------------------------------------------------------------------------
//
// Found on Kubuntu (KDE Plasma, XWayland): after the panel closed, the tab sat
// where the open panel's left edge had been instead of at the screen edge, and
// the next open started from there.
//
// GTK sends a move to the window manager straight away but queues a resize until
// its next layout pass (gtk_window_move / gtk_window_resize, GTK 3.24). So
// `set_size` then `set_position` reaches the window manager move-first. Shrinking
// a right dock, that moves the still-wide window mostly off the screen; KWin pulls
// it back fully on screen, and the resize that follows shrinks it from the left,
// stranding the tab inwards. Growing is unaffected: there the move comes first by
// design and keeps the window on screen.
//
// So on Linux a shrink waits for the new size to land before moving, and every
// placement is checked against where the window actually is, and applied again if
// the window manager put it elsewhere. The code compiles everywhere, so it is
// checked on every platform, but only Linux calls it.

/// Bumped on every placement, so a slower settle for an older target gives up
/// instead of dragging the window back to where it no longer belongs.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
static PLACEMENT_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// How long to wait for a request to show up in the window's reported geometry.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const SETTLE_TIMEOUT: Duration = Duration::from_millis(400);
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const SETTLE_POLL: Duration = Duration::from_millis(8);
/// Placement attempts before giving up and logging; the drift check retries later.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const SETTLE_ATTEMPTS: u32 = 3;

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn spawn_settle(app: &AppHandle, target: Rect) {
    let generation = PLACEMENT_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let handle = app.clone();
    if let Err(error) = std::thread::Builder::new()
        .name("dock-placement".into())
        .spawn(move || settle_rect(&handle, target, generation))
    {
        log::error!("dock: failed to start placement: {error}");
    }
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn window_rect(app: &AppHandle) -> Option<Rect> {
    app.get_webview_window(DOCK_WINDOW_LABEL)
        .and_then(|window| current_rect(&window))
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn on_main(app: &AppHandle, apply: impl FnOnce(&WebviewWindow) + Send + 'static) {
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window(DOCK_WINDOW_LABEL) {
            apply(&window);
        }
    }) {
        log::error!("dock: failed to schedule window update: {error}");
    }
}

/// Wait until the window's geometry satisfies `done`. False on timeout, or at
/// once if a newer placement has started.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn wait_for(app: &AppHandle, generation: u64, done: impl Fn(Rect) -> bool) -> bool {
    let deadline = Instant::now() + SETTLE_TIMEOUT;
    while Instant::now() < deadline {
        if PLACEMENT_GENERATION.load(Ordering::SeqCst) != generation {
            return false;
        }
        if window_rect(app).is_some_and(&done) {
            return true;
        }
        std::thread::sleep(SETTLE_POLL);
    }
    false
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn settle_rect(app: &AppHandle, target: Rect, generation: u64) {
    for attempt in 1..=SETTLE_ATTEMPTS {
        if PLACEMENT_GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }
        let Some(current) = window_rect(app) else {
            return;
        };
        if rect_settled(current, target) {
            return;
        }
        if attempt > 1 {
            log::warn!(
                "dock: window is at {current:?}, not {target:?}; placing it again (attempt {attempt})"
            );
        }

        let position = PhysicalPosition::new(target.x, target.y);
        let size = PhysicalSize::new(target.width, target.height);
        match apply_order(current, target) {
            ApplyOrder::MoveThenResize => {
                on_main(app, move |window| {
                    set_position(window, position);
                    set_size(window, size);
                });
            }
            ApplyOrder::ResizeThenMove => {
                on_main(app, move |window| set_size(window, size));
                // Move only once the smaller size has landed, so the window is
                // never wide and past the screen edge at the same time.
                let sized = wait_for(app, generation, |rect| {
                    rect.width.abs_diff(target.width) <= 1
                        && rect.height.abs_diff(target.height) <= 1
                });
                if !sized && PLACEMENT_GENERATION.load(Ordering::SeqCst) != generation {
                    return;
                }
                on_main(app, move |window| set_position(window, position));
            }
        }

        if wait_for(app, generation, |rect| rect_settled(rect, target)) {
            if attempt > 1 {
                log::info!("dock: window placed at {target:?} on attempt {attempt}");
            }
            return;
        }
    }
    if let Some(current) = window_rect(app) {
        log::warn!("dock: could not place the window at {target:?}; it is at {current:?}");
    }
}

/// Start the one and only polling thread.
pub fn spawn(app: AppHandle) {
    std::thread::Builder::new()
        .name("dock-poller".into())
        .spawn(move || {
            let mut next_monitor_check = Instant::now() + MONITOR_REFRESH;
            #[cfg(target_os = "linux")]
            let mut last_drift: Option<Rect> = None;
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

                    // Linux: a window manager can move the window after it was
                    // placed. While collapsed, put the tab back if it drifted.
                    #[cfg(target_os = "linux")]
                    if dock.phase() == Phase::Collapsed
                        && let Some(actual) = window_rect(&app)
                    {
                        let expected = dock.expected_window_rect();
                        if !rect_settled(actual, expected) {
                            // Once per position, so a window manager that keeps
                            // the tab somewhere else cannot fill the log.
                            if last_drift != Some(actual) {
                                log::warn!(
                                    "dock: tab drifted to {actual:?}, expected {expected:?}; moving it back"
                                );
                                last_drift = Some(actual);
                            }
                            spawn_settle(&app, expected);
                        }
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
