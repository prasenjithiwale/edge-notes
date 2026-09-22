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

/// Windows has no tray title at all and Linux only shows one in some panels, so
/// a failure here is logged once by the caller's own path and never retried in
/// a loop.
fn write(app: &AppHandle, title: Option<&str>) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    if let Err(error) = tray.set_title(title) {
        log::debug!("focus: the tray would not take a title: {error}");
    }
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
}
