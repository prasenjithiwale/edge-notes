//! The running pomodoro, on the menu bar.
//!
//! A widget that spends its life collapsed behind another window has one other
//! place it can say something: the tray. While a session runs, the time left is
//! the tray icon's title, so the timer is legible without opening anything —
//! the same reasoning as the red light on the collapsed tab, one level further
//! out.
//!
//! Rust keeps the time, as it does for reminders. The frontend's clock only
//! ticks while the Focus tab is on screen (a collapsed panel's timers are
//! throttled or stopped), so a menu-bar countdown driven from there would lose
//! minutes without knowing. What it sends is the *moment* the phase ends, and
//! this counts down to it.

use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::Duration;

use serde::Deserialize;
use tauri::AppHandle;

use crate::tray::TRAY_ID;

/// How often the title is recomputed. A second, because it shows seconds.
const TICK: Duration = Duration::from_secs(1);

/// What the frontend sends: the end of the phase, or nothing at all.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    /// Unix milliseconds, or `None` while paused, finished or never started.
    pub ends_at: Option<i64>,
}

#[derive(Debug, Default)]
struct State {
    session: Session,
    /// What the tray is currently showing, so an unchanged second is not written.
    shown: Option<String>,
    /// The minutes the tray icon shows on Windows and Linux, which have no title
    /// beside the icon: the icon itself becomes the countdown, once a minute.
    badge: Option<String>,
    stopped: bool,
}

#[derive(Debug, Default)]
pub struct FocusTimer {
    state: Mutex<State>,
    wake: Condvar,
}

/// `mm:ss`, counting down, never negative and never past its own end.
///
/// Minutes are not wrapped into hours: a phase is minutes long by definition,
/// and `90:00` says more in a menu bar than `1:30:00` does.
#[must_use]
pub fn label(remaining_ms: i64) -> String {
    let total = (remaining_ms.max(0) + 999) / 1_000;
    format!("{}:{:02}", total / 60, total % 60)
}

impl FocusTimer {
    #[must_use]
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// The session to count down to, or an empty one to clear the title.
    pub fn set(&self, session: Session) {
        self.lock().session = session;
        self.wake.notify_all();
    }

    pub fn stop(&self) {
        self.lock().stopped = true;
        self.wake.notify_all();
    }

    pub fn spawn(self: &Arc<Self>, app: AppHandle) {
        let timer = Arc::clone(self);
        std::thread::Builder::new()
            .name("focus-timer".into())
            .spawn(move || timer.run(&app))
            // Not fatal: the panel still shows the timer, and the tab still
            // shows that one is running.
            .map_or_else(
                |error| log::error!("focus: could not start the menu-bar timer: {error}"),
                |_| (),
            );
    }

    fn run(&self, app: &AppHandle) {
        let mut state = self.lock();
        loop {
            if state.stopped {
                // Leave nothing behind on the menu bar.
                write(app, None);
                write_badge(app, None, None);
                return;
            }

            let wanted = state.session.ends_at.and_then(|ends_at| {
                let remaining = ends_at - crate::db::now_ms();
                // The phase's own end stops the countdown; the frontend settles
                // the state itself the next time anything asks it to.
                (remaining > -1_000).then(|| label(remaining))
            });

            if wanted != state.shown {
                write(app, wanted.as_deref());
                let badge = wanted.as_deref().map(badge_text);
                if badge != state.badge {
                    write_badge(app, badge.as_deref(), wanted.as_deref());
                    state.badge = badge;
                }
                state.shown = wanted;
            }

            // A second while something is counting, and otherwise until the
            // frontend says something changed.
            state = if state.session.ends_at.is_some() {
                self.wake
                    .wait_timeout(state, TICK)
                    .map_or_else(|poisoned| poisoned.into_inner().0, |(guard, _)| guard)
            } else {
                self.wake
                    .wait(state)
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
            };
        }
    }
}

/// Put the countdown on the menu bar.
///
/// On macOS it goes on as an **attributed** title, which is the only way it can
/// be red: Tauri's tray takes a plain string and keeps its `NSStatusItem`
/// private. That has to happen on the main thread, and it falls back to the
/// plain title if the status bar's button cannot be found — a countdown in the
/// wrong colour beats no countdown.
///
/// Windows has no tray title at all and Linux only shows one in some panels, so
/// a refusal is logged at debug and never retried in a loop.
fn write(app: &AppHandle, title: Option<&str>) {
    // The plain title first, always: it is what gives the status item its
    // width. An attributed title on its own colours text the item has left no
    // room for, and the countdown disappears altogether.
    plain(app, title);

    #[cfg(target_os = "macos")]
    {
        let owned = title.map(str::to_owned);
        let _ = app.run_on_main_thread(move || {
            // Then the colour, over the top of the text already measured.
            let _ = crate::platform::macos::set_tray_countdown(owned.as_deref());
        });
    }
}

fn plain(app: &AppHandle, title: Option<&str>) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    if let Err(error) = tray.set_title(title) {
        log::debug!("focus: the tray would not take a title: {error}");
    }
}

/// The minutes a badge shows for a `label`, rounded up so it agrees with the
/// clock: `24:57` is 25, and the last minute is 1 until it is over.
#[must_use]
pub fn badge_text(label: &str) -> String {
    let (minutes, seconds) = label.split_once(':').unwrap_or((label, "0"));
    let minutes: u32 = minutes.parse().unwrap_or(0);
    let seconds: u32 = seconds.parse().unwrap_or(0);
    (minutes + u32::from(seconds > 0)).to_string()
}

/// Windows and Linux: the tray icon becomes the countdown while a phase runs,
/// because neither shows a title beside a tray icon (a few Linux panels do, and
/// get the plain title as well). The time to the second goes in the tooltip.
/// `None` puts the ordinary icon back. macOS has its pill in the title instead.
fn write_badge(app: &AppHandle, badge: Option<&str>, label: Option<&str>) {
    #[cfg(not(target_os = "macos"))]
    {
        let Some(tray) = app.tray_by_id(TRAY_ID) else {
            return;
        };
        let icon = match badge {
            Some(text) => Some(tauri::image::Image::new_owned(
                badge_rgba(text),
                BADGE_SIZE,
                BADGE_SIZE,
            )),
            None => crate::tray::default_icon(),
        };
        if let Err(error) = tray.set_icon(icon) {
            log::debug!("focus: the tray would not take the countdown icon: {error}");
        }
        let tooltip = label.map(|label| format!("Focus: {label} left"));
        if let Err(error) = tray.set_tooltip(tooltip.as_deref().or(Some("Ledge"))) {
            log::debug!("focus: the tray would not take a tooltip: {error}");
        }
    }
    #[cfg(target_os = "macos")]
    let _ = (app, badge, label);
}

/// The badge's size in pixels. Tray icons are drawn at 16 to 32 px; 32 is the
/// largest either system asks for, and scales down cleanly.
pub const BADGE_SIZE: u32 = 32;

/// The focus light's red, as on the collapsed tab (`--focus-running`).
const BADGE_RED: [u8; 3] = [215, 0, 21];

/// Digits in a 3×5 pixel font, one row per byte, three bits a row. Drawn rather
/// than rendered: there is no text rasteriser in the build, and a pixel font is
/// what reads at 16 px anyway.
const DIGITS: [[u8; 5]; 10] = [
    [0b111, 0b101, 0b101, 0b101, 0b111],
    [0b010, 0b110, 0b010, 0b010, 0b111],
    [0b111, 0b001, 0b111, 0b100, 0b111],
    [0b111, 0b001, 0b111, 0b001, 0b111],
    [0b101, 0b101, 0b111, 0b001, 0b001],
    [0b111, 0b100, 0b111, 0b001, 0b111],
    [0b111, 0b100, 0b111, 0b101, 0b111],
    [0b111, 0b001, 0b001, 0b001, 0b001],
    [0b111, 0b101, 0b111, 0b101, 0b111],
    [0b111, 0b101, 0b111, 0b001, 0b111],
];

/// A red rounded square with `text` (digits) in white, as `BADGE_SIZE`² RGBA.
/// Two digits are drawn at 4× the pixel font, three (100 minutes and up) at 3×
/// with a narrower gap, so they still fit.
#[must_use]
pub fn badge_rgba(text: &str) -> Vec<u8> {
    let size = BADGE_SIZE as usize;
    let mut pixels = vec![0u8; size * size * 4];

    // The rounded square, with its corners anti-aliased by 4×4 supersampling.
    let radius = 7.0_f64;
    let edge = size as f64;
    for y in 0..size {
        for x in 0..size {
            let mut inside = 0u32;
            for sy in 0..4 {
                for sx in 0..4 {
                    let px = x as f64 + (f64::from(sx) + 0.5) / 4.0;
                    let py = y as f64 + (f64::from(sy) + 0.5) / 4.0;
                    let cx = px.clamp(radius, edge - radius);
                    let cy = py.clamp(radius, edge - radius);
                    if (px - cx).powi(2) + (py - cy).powi(2) <= radius * radius {
                        inside += 1;
                    }
                }
            }
            if inside > 0 {
                let at = (y * size + x) * 4;
                pixels[at..at + 3].copy_from_slice(&BADGE_RED);
                pixels[at + 3] = u8::try_from(inside * 255 / 16).unwrap_or(255);
            }
        }
    }

    let digits: Vec<usize> = text
        .chars()
        .filter_map(|c| c.to_digit(10))
        .filter_map(|d| usize::try_from(d).ok())
        .collect();
    if digits.is_empty() {
        return pixels;
    }
    // Two digits at 4× with a 4 px gap are 28 px wide; three at 3× need the
    // gap down to 1 px to come to 29, which leaves red on both sides of 32.
    let (scale, gap) = if digits.len() <= 2 { (4, 4) } else { (3, 1) };
    let width = digits.len() * 3 * scale + (digits.len() - 1) * gap;
    let height = 5 * scale;
    let left = size.saturating_sub(width) / 2;
    let top = size.saturating_sub(height) / 2;
    for (index, digit) in digits.iter().enumerate() {
        let origin = left + index * (3 * scale + gap);
        for (row, bits) in DIGITS[*digit].iter().enumerate() {
            for column in 0..3 {
                if bits & (0b100 >> column) == 0 {
                    continue;
                }
                for dy in 0..scale {
                    for dx in 0..scale {
                        let x = origin + column * scale + dx;
                        let y = top + row * scale + dy;
                        if x < size && y < size {
                            let at = (y * size + x) * 4;
                            pixels[at..at + 4].copy_from_slice(&[255, 255, 255, 255]);
                        }
                    }
                }
            }
        }
    }
    pixels
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The one thing worth pinning: a countdown that reads as the clock does.
    #[test]
    fn a_countdown_rounds_up_and_stops_at_zero() {
        // 25 minutes exactly, and the first tick of it.
        assert_eq!(label(25 * 60 * 1_000), "25:00");
        assert_eq!(label(24 * 60 * 1_000 + 59_001), "25:00");
        // Rounding up is what makes the last second show as 0:01 rather than
        // 0:00 for two seconds running.
        assert_eq!(label(1), "0:01");
        assert_eq!(label(1_000), "0:01");
        assert_eq!(label(1_001), "0:02");
        assert_eq!(label(0), "0:00");
        assert_eq!(label(-5_000), "0:00");
        // Minutes are not wrapped into hours.
        assert_eq!(label(90 * 60 * 1_000), "90:00");
    }

    /// The badge agrees with the clock: whole minutes, rounded up.
    #[test]
    fn a_badge_shows_the_minutes_left_rounded_up() {
        assert_eq!(badge_text("25:00"), "25");
        assert_eq!(badge_text("24:57"), "25");
        assert_eq!(badge_text("0:45"), "1");
        assert_eq!(badge_text("0:00"), "0");
        assert_eq!(badge_text("119:30"), "120");
    }

    /// A white digit on a red rounded square, with clear corners.
    #[test]
    fn a_badge_is_white_digits_on_a_rounded_red_square() {
        let size = BADGE_SIZE as usize;
        let pixel = |pixels: &[u8], x: usize, y: usize| {
            let at = (y * size + x) * 4;
            [pixels[at], pixels[at + 1], pixels[at + 2], pixels[at + 3]]
        };
        let pixels = badge_rgba("25");
        assert_eq!(pixels.len(), size * size * 4);
        // The corner is outside the rounding; the middle of an edge is red.
        assert_eq!(pixel(&pixels, 0, 0)[3], 0);
        assert_eq!(pixel(&pixels, 16, 1), [215, 0, 21, 255]);
        // "2" starts with a full top row: its first pixel is white.
        let left = (size - (2 * 12 + 4)) / 2;
        let top = (size - 20) / 2;
        assert_eq!(pixel(&pixels, left, top), [255, 255, 255, 255]);
        // Three digits still fit inside the square, clear of both edges.
        let wide = badge_rgba("120");
        let white = [255, 255, 255, 255];
        assert!((0..size).all(|y| pixel(&wide, 0, y) != white));
        assert!((0..size).all(|y| pixel(&wide, size - 1, y) != white));
        assert!((0..size).any(|y| pixel(&wide, 1, y) == white));
    }
}
