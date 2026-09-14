//! Task reminders: a system notification when a task falls due.
//!
//! The frontend owns the task format, so it works out every reminder — when,
//! and what to say — and hands the whole list over with `reminders_set` whenever
//! notes change. Rust owns the time: one thread sleeps until the next reminder,
//! shows it, and remembers what it has shown so a re-sent list never repeats one.
//!
//! The deciding logic (`due`, `next_at`) is pure and takes the time, like the dock
//! controller; the thread is the only part that touches the clock or Tauri.

use std::collections::HashSet;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::Duration;

use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

use crate::db::now_ms;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    /// Stable while the task and its due time are unchanged.
    pub id: String,
    /// Unix milliseconds.
    pub at: i64,
    pub title: String,
    pub body: String,
}

/// A reminder missed by less than this still shows — the Mac was asleep, or the
/// app was launched just after — and anything older is only visible as overdue.
const LATE_GRACE_MS: i64 = 10 * 60_000;

/// The thread wakes at least this often even with nothing due, so a clock change
/// or a long sleep is noticed without waiting for a far-off reminder.
const IDLE_WAKE: Duration = Duration::from_secs(60);

/// Reminders to show now: due, not too late, and not shown before.
#[must_use]
pub fn due<'a>(reminders: &'a [Reminder], shown: &HashSet<String>, now: i64) -> Vec<&'a Reminder> {
    reminders
        .iter()
        .filter(|reminder| {
            reminder.at <= now
                && now - reminder.at <= LATE_GRACE_MS
                && !shown.contains(&reminder.id)
        })
        .collect()
}

/// When the next reminder falls due, if any is still ahead.
#[must_use]
pub fn next_at(reminders: &[Reminder], shown: &HashSet<String>, now: i64) -> Option<i64> {
    reminders
        .iter()
        .filter(|reminder| reminder.at > now && !shown.contains(&reminder.id))
        .map(|reminder| reminder.at)
        .min()
}

#[derive(Debug, Default)]
struct State {
    reminders: Vec<Reminder>,
    shown: HashSet<String>,
    enabled: bool,
    stopped: bool,
}

#[derive(Debug, Default)]
pub struct Reminders {
    state: Mutex<State>,
    wake: Condvar,
}

impl Reminders {
    #[must_use]
    pub fn new(enabled: bool) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(State {
                enabled,
                ..State::default()
            }),
            wake: Condvar::new(),
        })
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Replace the schedule. Anything already shown and still listed stays shown.
    pub fn set(&self, reminders: Vec<Reminder>) {
        let mut state = self.lock();
        let listed: HashSet<&str> = reminders.iter().map(|r| r.id.as_str()).collect();
        state.shown.retain(|id| listed.contains(id.as_str()));
        state.reminders = reminders;
        drop(state);
        self.wake.notify_all();
    }

    /// The `tasks.reminders` setting, applied live.
    pub fn set_enabled(&self, enabled: bool) {
        self.lock().enabled = enabled;
        self.wake.notify_all();
    }

    pub fn stop(&self) {
        self.lock().stopped = true;
        self.wake.notify_all();
    }

    /// The reminder thread. Returns when `stop` is called.
    pub fn spawn(self: &Arc<Self>, app: AppHandle) {
        let reminders = Arc::clone(self);
        std::thread::spawn(move || reminders.run(&app));
    }

    fn run(&self, app: &AppHandle) {
        let mut state = self.lock();
        loop {
            if state.stopped {
                return;
            }
            let now = now_ms();
            let ready: Vec<Reminder> = due(&state.reminders, &state.shown, now)
                .into_iter()
                .cloned()
                .collect();
            for reminder in &ready {
                // Marked even while reminders are off, so turning them back on
                // does not bring up a burst of ones that passed meanwhile.
                state.shown.insert(reminder.id.clone());
            }
            let enabled = state.enabled;
            let wait = next_at(&state.reminders, &state.shown, now).map_or(IDLE_WAKE, |at| {
                Duration::from_millis(u64::try_from(at - now).unwrap_or(0)).min(IDLE_WAKE)
            });

            if enabled && !ready.is_empty() {
                drop(state);
                for reminder in ready {
                    if let Err(error) = app
                        .notification()
                        .builder()
                        .title(&reminder.title)
                        .body(&reminder.body)
                        .show()
                    {
                        log::error!("reminders: could not show a notification: {error}");
                    }
                }
                state = self.lock();
                continue;
            }

            state = match self.wake.wait_timeout(state, wait) {
                Ok((guard, _)) => guard,
                Err(poisoned) => poisoned.into_inner().0,
            };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reminder(id: &str, at: i64) -> Reminder {
        Reminder {
            id: id.to_owned(),
            at,
            title: id.to_owned(),
            body: String::new(),
        }
    }

    const NOW: i64 = 1_789_000_000_000;

    #[test]
    fn shows_what_is_due_and_not_yet_shown() {
        let list = [
            reminder("past", NOW - 1_000),
            reminder("exact", NOW),
            reminder("future", NOW + 1_000),
        ];
        let shown = HashSet::from(["past".to_owned()]);
        let ready: Vec<&str> = due(&list, &shown, NOW)
            .iter()
            .map(|r| r.id.as_str())
            .collect();
        assert_eq!(ready, ["exact"]);
    }

    #[test]
    fn skips_a_reminder_missed_by_more_than_the_grace() {
        let list = [
            reminder("just missed", NOW - LATE_GRACE_MS),
            reminder("long gone", NOW - LATE_GRACE_MS - 1),
        ];
        let ready: Vec<&str> = due(&list, &HashSet::new(), NOW)
            .iter()
            .map(|r| r.id.as_str())
            .collect();
        assert_eq!(ready, ["just missed"]);
    }

    #[test]
    fn next_at_is_the_soonest_future_reminder_not_shown() {
        let list = [
            reminder("later", NOW + 5_000),
            reminder("sooner", NOW + 2_000),
            reminder("shown", NOW + 1_000),
            reminder("past", NOW - 1),
        ];
        let shown = HashSet::from(["shown".to_owned()]);
        assert_eq!(next_at(&list, &shown, NOW), Some(NOW + 2_000));
        assert_eq!(next_at(&[], &shown, NOW), None);
    }

    #[test]
    fn a_resent_list_keeps_what_was_shown_and_forgets_what_was_removed() {
        let reminders = Reminders::new(true);
        reminders.set(vec![reminder("a", NOW), reminder("b", NOW)]);
        {
            let mut state = reminders.lock();
            state.shown.insert("a".to_owned());
            state.shown.insert("b".to_owned());
        }
        reminders.set(vec![reminder("a", NOW)]);
        let state = reminders.lock();
        assert!(state.shown.contains("a"));
        assert!(!state.shown.contains("b"));
    }

    #[test]
    fn parses_the_frontend_shape() {
        let parsed: Vec<Reminder> = serde_json::from_str(
            r#"[{"id":"n|Pay rent|2026-10-01|","at":1789000000000,"title":"Pay rent","body":"Due today · Home"}]"#,
        )
        .expect("parse");
        assert_eq!(parsed[0].title, "Pay rent");
        assert_eq!(parsed[0].at, 1_789_000_000_000);
    }
}
