//! The clipboard history: the last things copied, anywhere, as text.
//!
//! Rust watches and the webview is told, as with everything stateful — the
//! webview has no clipboard permission, and its timers stop while the panel is
//! collapsed, which is exactly when things are being copied elsewhere.
//!
//! **Kept in memory only.** A clipboard sees passwords, one-time codes and
//! whatever else went through it, and a history written to disk would be a
//! record of all of it; one that ends with the process is a convenience. Copies
//! a password manager marks as concealed are never kept at all (macOS, see
//! `platform::clipboard_state`).

use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::db::now_ms;
use crate::platform;

/// Sent with the whole list whenever it changes.
pub const CLIPS_EVENT: &str = "clips:changed";

/// How often the clipboard is looked at. On macOS that is one integer; the
/// text is read only when it has moved.
const POLL: Duration = Duration::from_secs(1);

/// How many are kept. Older ones fall off the end.
pub const MAX_CLIPS: usize = 50;

/// Larger copies are not kept: a history row is for a line or a paragraph, and
/// fifty megabyte log dumps would make one of the app's largest allocations.
pub const MAX_BYTES: usize = 100_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: u64,
    pub text: String,
    /// Unix milliseconds: when it was last copied.
    pub copied_at: i64,
    /// Whether this is what is on the clipboard now. Filled in by `list`.
    pub current: bool,
}

#[derive(Debug, Default)]
struct State {
    clips: Vec<Clip>,
    next_id: u64,
    /// The entry on the clipboard now; `None` once something that is not kept
    /// (a picture, a password) has been copied over it.
    current: Option<u64>,
    stopped: bool,
}

#[derive(Debug, Default)]
pub struct Clips {
    state: Mutex<State>,
    wake: Condvar,
}

impl Clips {
    #[must_use]
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Newest first.
    #[must_use]
    pub fn list(&self) -> Vec<Clip> {
        let state = self.lock();
        state
            .clips
            .iter()
            .map(|clip| Clip {
                current: state.current == Some(clip.id),
                ..clip.clone()
            })
            .collect()
    }

    /// Put a copy at the top. Something copied again moves up rather than
    /// appearing twice, keeping its id. Returns whether the list changed.
    pub fn record(&self, text: &str, now: i64) -> bool {
        if text.trim().is_empty() || text.len() > MAX_BYTES {
            return self.lost();
        }
        let mut state = self.lock();
        if let Some(top) = state.clips.first().filter(|clip| clip.text == text) {
            let id = Some(top.id);
            let changed = state.current != id;
            state.current = id;
            return changed;
        }
        let clip = match state.clips.iter().position(|clip| clip.text == text) {
            Some(index) => {
                let mut clip = state.clips.remove(index);
                clip.copied_at = now;
                clip
            }
            None => {
                state.next_id += 1;
                Clip {
                    id: state.next_id,
                    text: text.to_owned(),
                    copied_at: now,
                    current: false,
                }
            }
        };
        state.current = Some(clip.id);
        state.clips.insert(0, clip);
        state.clips.truncate(MAX_CLIPS);
        true
    }

    /// What is on the clipboard now is not in the history. Returns whether that
    /// changed anything.
    pub fn lost(&self) -> bool {
        self.lock().current.take().is_some()
    }

    /// Returns whether it was there.
    pub fn remove(&self, id: u64) -> bool {
        let mut state = self.lock();
        let before = state.clips.len();
        state.clips.retain(|clip| clip.id != id);
        state.clips.len() != before
    }

    pub fn clear(&self) {
        self.lock().clips.clear();
    }

    pub fn stop(&self) {
        self.lock().stopped = true;
        self.wake.notify_all();
    }

    pub fn spawn(self: &Arc<Self>, app: AppHandle) {
        let clips = Arc::clone(self);
        let spawned = std::thread::Builder::new()
            .name("clips".into())
            .spawn(move || clips.run(&app));
        if let Err(error) = spawned {
            log::error!("clips: could not start the clipboard watcher: {error}");
        }
    }

    fn run(&self, app: &AppHandle) {
        let mut last_change: Option<isize> = None;
        let mut last_text: Option<String> = None;
        loop {
            {
                let state = self.lock();
                let (state, _) = self
                    .wake
                    .wait_timeout(state, POLL)
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if state.stopped {
                    return;
                }
            }
            let stamp = platform::clipboard_state();
            if let Some((change, private)) = stamp {
                if last_change == Some(change) {
                    continue;
                }
                last_change = Some(change);
                if private {
                    if self.lost() {
                        self.announce(app);
                    }
                    continue;
                }
            }
            let Some(text) = read_text(app) else {
                if self.lost() {
                    self.announce(app);
                }
                continue;
            };
            // Without a change count, the text itself is the only sign of a copy.
            if stamp.is_none() && last_text.as_deref() == Some(text.as_str()) {
                continue;
            }
            if self.record(&text, now_ms()) {
                self.announce(app);
            }
            last_text = Some(text);
        }
    }

    fn announce(&self, app: &AppHandle) {
        if let Err(error) = app.emit(CLIPS_EVENT, self.list()) {
            log::error!("clips: could not announce a copy: {error}");
        }
    }
}

/// The clipboard's text. An image, a file or nothing at all is an error from
/// the plugin and an ordinary moment here, so it is not logged as one.
fn read_text(app: &AppHandle) -> Option<String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    match app.clipboard().read_text() {
        Ok(text) => Some(text),
        Err(error) => {
            log::debug!("clips: no text on the clipboard: {error}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(clips: &Clips) -> Vec<String> {
        clips.list().into_iter().map(|clip| clip.text).collect()
    }

    #[test]
    fn newest_first_and_a_repeat_moves_up_keeping_its_id() {
        let clips = Clips::default();
        assert!(clips.record("a", 1));
        assert!(clips.record("b", 2));
        let id = clips.list()[1].id;
        assert!(clips.record("a", 3));
        assert_eq!(texts(&clips), ["a", "b"]);
        assert_eq!(clips.list()[0].id, id);
        assert_eq!(clips.list()[0].copied_at, 3);
        // Already on top: nothing changed.
        assert!(!clips.record("a", 4));
    }

    #[test]
    fn marks_what_is_on_the_clipboard_now() {
        let clips = Clips::default();
        clips.record("a", 1);
        clips.record("b", 2);
        let current = |clips: &Clips| -> Vec<bool> {
            clips.list().into_iter().map(|clip| clip.current).collect()
        };
        assert_eq!(current(&clips), [true, false]);
        // A password or a picture copied over it: nothing in the list is current.
        assert!(clips.lost());
        assert!(!clips.lost());
        assert_eq!(current(&clips), [false, false]);
        // The same text copied again becomes current without moving.
        assert!(clips.record("b", 3));
        assert_eq!(current(&clips), [true, false]);
    }

    #[test]
    fn blank_and_huge_copies_are_not_kept() {
        let clips = Clips::default();
        assert!(!clips.record("  \n", 1));
        assert!(!clips.record(&"x".repeat(MAX_BYTES + 1), 1));
        assert!(clips.list().is_empty());
    }

    #[test]
    fn the_oldest_falls_off() {
        let clips = Clips::default();
        for n in 0..=MAX_CLIPS {
            clips.record(&n.to_string(), 0);
        }
        assert_eq!(clips.list().len(), MAX_CLIPS);
        assert_eq!(clips.list()[0].text, MAX_CLIPS.to_string());
        assert!(!texts(&clips).contains(&"0".to_owned()));
    }

    #[test]
    fn remove_and_clear() {
        let clips = Clips::default();
        clips.record("a", 1);
        clips.record("b", 2);
        let id = clips.list()[0].id;
        assert!(clips.remove(id));
        assert!(!clips.remove(id));
        assert_eq!(texts(&clips), ["a"]);
        clips.clear();
        assert!(clips.list().is_empty());
    }
}
