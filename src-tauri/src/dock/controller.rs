//! The dock state machine.
//!
//! Pure: it takes cursor samples, frontend events and a clock, and returns
//! actions for the caller to apply. It never touches Tauri, so every transition
//! in brief 6.1–6.3 is testable with a fake clock.

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::geometry::{DockGeometry, Rect, Side};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Collapsed,
    Opening,
    Open,
    Closing,
}

impl Phase {
    #[must_use]
    pub fn is_expanded(self) -> bool {
        !matches!(self, Self::Collapsed)
    }
}

/// The `dock:state` payload (brief 9.4).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockState {
    pub phase: Phase,
    pub side: Side,
    pub tab_top: f64,
    pub keep_open: bool,
}

/// What the caller must do. `poller.rs` is the only thing that applies these.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Action {
    SetWindowRect(Rect),
    EmitState(DockState),
    Focus,
}

#[derive(Debug, Clone, Copy)]
pub enum Input {
    /// Physical pixels, desktop coordinates.
    Cursor {
        x: f64,
        y: f64,
    },
    SetKeepOpen(bool),
    SetInteractionLock(bool),
    AnimationDone(Phase),
    Toggle,
    WindowBlurred,
    /// Linux secondary signal (brief 8.10).
    PointerLeftWebview,
    MonitorChanged,
}

/// Brief 6.2 defaults, in one place so settings can override them later.
#[derive(Debug, Clone, Copy)]
pub struct Timings {
    pub open_delay: Duration,
    pub close_delay: Duration,
    pub ack_timeout: Duration,
    pub close_tolerance_logical: f64,
    pub near_edge_logical: f64,
    pub fast_poll: Duration,
    pub slow_poll: Duration,
}

impl Default for Timings {
    fn default() -> Self {
        Self {
            open_delay: Duration::from_millis(120),
            close_delay: Duration::from_millis(400),
            ack_timeout: Duration::from_millis(300),
            close_tolerance_logical: 8.0,
            near_edge_logical: 150.0,
            fast_poll: Duration::from_millis(33),
            slow_poll: Duration::from_millis(150),
        }
    }
}

/// How long after a deliberate open a blur is treated as the window server
/// settling rather than the user leaving. Long enough to cover the bounce
/// observed on macOS (~1 s), short enough that letting go of the panel still
/// feels immediate.
const FOCUS_SETTLE: Duration = Duration::from_millis(1_500);

pub struct DockController {
    geometry: DockGeometry,
    timings: Timings,
    phase: Phase,
    keep_open: bool,
    interaction_lock: bool,
    /// Opened by shortcut or tray: does not auto-close on cursor leave (6.3).
    opened_by_shortcut: bool,
    /// When the panel was last opened deliberately, so a blur that arrives in the
    /// same breath can be told from the user switching away. macOS hands focus
    /// straight back to the previously active app when an `Accessory` app
    /// activates itself, and brief 6.3 closes a shortcut-opened panel on blur —
    /// so without this the panel shut itself the instant it appeared.
    opened_deliberately_at: Option<Instant>,
    /// Set when the user dismissed the panel outright (Esc, shortcut, tray) while
    /// the cursor was still on it. Brief 6.1 reverses a close when the cursor
    /// *re-enters*, which presumes it left; without this, a cursor that never
    /// left reopened the panel in the same breath and Esc looked broken — and
    /// with Keep open on, nothing could dismiss the panel at all. Cleared as soon
    /// as the cursor is seen outside.
    dismissed: bool,
    hover_since: Option<Instant>,
    leave_since: Option<Instant>,
    ack_deadline: Option<Instant>,
    last_cursor: Option<(f64, f64)>,
}

impl DockController {
    #[must_use]
    pub fn new(geometry: DockGeometry, timings: Timings) -> Self {
        Self {
            geometry,
            timings,
            phase: Phase::Collapsed,
            keep_open: false,
            interaction_lock: false,
            opened_by_shortcut: false,
            opened_deliberately_at: None,
            dismissed: false,
            hover_since: None,
            leave_since: None,
            ack_deadline: None,
            last_cursor: None,
        }
    }

    #[must_use]
    pub fn phase(&self) -> Phase {
        self.phase
    }

    #[must_use]
    pub fn keep_open(&self) -> bool {
        self.keep_open
    }

    #[must_use]
    pub fn geometry(&self) -> &DockGeometry {
        &self.geometry
    }

    #[must_use]
    pub fn state(&self) -> DockState {
        DockState {
            phase: self.phase,
            side: self.geometry.side(),
            tab_top: if self.phase.is_expanded() {
                self.geometry.tab_top_logical()
            } else {
                0.0
            },
            keep_open: self.keep_open,
        }
    }

    /// The window rect the current phase should be showing.
    #[must_use]
    fn rect_for_phase(&self) -> Rect {
        if self.phase.is_expanded() {
            self.geometry.expanded_window_rect()
        } else {
            self.geometry.collapsed_window_rect()
        }
    }

    fn cursor_inside(&self, x: f64, y: f64) -> bool {
        if self.phase.is_expanded() {
            self.geometry
                .hit_open(x, y, self.timings.close_tolerance_logical)
        } else {
            self.geometry.hit_collapsed(x, y, 0.0)
        }
    }

    /// Adaptive polling (brief 8.2).
    #[must_use]
    pub fn poll_interval(&self) -> Duration {
        if self.phase.is_expanded() {
            return self.timings.fast_poll;
        }
        match self.last_cursor {
            Some((x, y))
                if self
                    .geometry
                    .near_edge(x, y, self.timings.near_edge_logical) =>
            {
                self.timings.fast_poll
            }
            _ => self.timings.slow_poll,
        }
    }

    pub fn handle(&mut self, input: Input, now: Instant) -> Vec<Action> {
        match input {
            Input::Cursor { x, y } => self.on_cursor(x, y, now),
            Input::SetKeepOpen(value) => self.on_keep_open(value, now),
            Input::SetInteractionLock(value) => self.on_interaction_lock(value, now),
            Input::AnimationDone(phase) => self.on_animation_done(phase),
            Input::Toggle => self.on_toggle(now),
            Input::WindowBlurred => self.on_blur(now),
            Input::PointerLeftWebview => self.on_pointer_left(now),
            Input::MonitorChanged => self.on_monitor_changed(),
        }
    }

    /// Time-driven transitions: hover intent, close delay, acknowledgment timeouts.
    pub fn tick(&mut self, now: Instant) -> Vec<Action> {
        match self.phase {
            Phase::Collapsed => {
                if let Some(since) = self.hover_since
                    && now.duration_since(since) >= self.timings.open_delay
                {
                    return self.begin_open(now, false);
                }
                Vec::new()
            }
            Phase::Opening => {
                // Defensive: if the slide-in is never acknowledged, treat it as open
                // anyway so auto-close can still run.
                if self.ack_expired(now) {
                    self.phase = Phase::Open;
                    self.ack_deadline = None;
                }
                if self.should_close(now) {
                    return self.begin_close(now);
                }
                Vec::new()
            }
            Phase::Open => {
                if self.should_close(now) {
                    return self.begin_close(now);
                }
                Vec::new()
            }
            Phase::Closing => {
                // Brief 8.4: shrink anyway if the frontend does not acknowledge.
                if self.ack_expired(now) {
                    return self.finish_close();
                }
                Vec::new()
            }
        }
    }

    fn ack_expired(&self, now: Instant) -> bool {
        self.ack_deadline.is_some_and(|deadline| now >= deadline)
    }

    fn should_close(&self, now: Instant) -> bool {
        if self.keep_open || self.interaction_lock || self.opened_by_shortcut {
            return false;
        }
        self.leave_since
            .is_some_and(|since| now.duration_since(since) >= self.timings.close_delay)
    }

    fn on_cursor(&mut self, x: f64, y: f64, now: Instant) -> Vec<Action> {
        self.last_cursor = Some((x, y));
        let inside = self.cursor_inside(x, y);

        if !inside {
            // The cursor has left, so a dismissal has run its course: hover may
            // open the panel again.
            self.dismissed = false;
        }

        match self.phase {
            Phase::Collapsed => {
                if inside && !self.dismissed {
                    // Hover intent: start the clock, don't restart it every sample.
                    self.hover_since.get_or_insert(now);
                } else {
                    self.hover_since = None;
                }
                Vec::new()
            }
            Phase::Opening | Phase::Open => {
                if inside {
                    self.leave_since = None;
                } else {
                    self.leave_since.get_or_insert(now);
                }
                Vec::new()
            }
            Phase::Closing => {
                if inside && !self.dismissed {
                    // Re-entry during close reverses without resizing the window.
                    self.begin_open(now, false)
                } else {
                    Vec::new()
                }
            }
        }
    }

    fn on_keep_open(&mut self, value: bool, now: Instant) -> Vec<Action> {
        self.keep_open = value;
        if value {
            self.leave_since = None;
        } else if !self.cursor_is_inside() {
            // Restart the delay: the cursor may have been away for minutes while
            // the panel was pinned, and closing the instant it is unpinned is
            // jarring.
            self.leave_since = Some(now);
        }
        vec![Action::EmitState(self.state())]
    }

    fn on_interaction_lock(&mut self, value: bool, now: Instant) -> Vec<Action> {
        self.interaction_lock = value;
        if !value && !self.cursor_is_inside() {
            // Restart the close delay rather than closing on a stale timestamp.
            self.leave_since = Some(now);
        }
        Vec::new()
    }

    fn cursor_is_inside(&self) -> bool {
        self.last_cursor
            .is_some_and(|(x, y)| self.cursor_inside(x, y))
    }

    fn on_animation_done(&mut self, phase: Phase) -> Vec<Action> {
        match (self.phase, phase) {
            (Phase::Opening, Phase::Opening) => {
                self.phase = Phase::Open;
                self.ack_deadline = None;
                Vec::new()
            }
            (Phase::Closing, Phase::Closing) => self.finish_close(),
            // A late acknowledgment for a phase we already left is ignored.
            _ => Vec::new(),
        }
    }

    fn on_toggle(&mut self, now: Instant) -> Vec<Action> {
        match self.phase {
            Phase::Collapsed | Phase::Closing => {
                let mut actions = self.begin_open(now, true);
                actions.push(Action::Focus);
                actions
            }
            Phase::Opening | Phase::Open => {
                // Explicit: hold the close even if the cursor never leaves.
                self.dismissed = true;
                self.begin_close(now)
            }
        }
    }

    fn on_blur(&mut self, now: Instant) -> Vec<Action> {
        if self.keep_open || !self.phase.is_expanded() {
            return Vec::new();
        }
        if self
            .opened_deliberately_at
            .is_some_and(|opened| now.duration_since(opened) < FOCUS_SETTLE)
        {
            // Focus bouncing back moments after we asked for it is the window
            // server settling, not a decision by the user.
            return Vec::new();
        }
        // Another app took focus, so no field of ours holds focus any more.
        self.interaction_lock = false;
        if self.opened_by_shortcut {
            // Shortcut-opened panels close when another app takes focus (6.3).
            return self.begin_close(now);
        }
        if !self.cursor_is_inside() {
            self.leave_since.get_or_insert(now);
        }
        Vec::new()
    }

    fn on_pointer_left(&mut self, now: Instant) -> Vec<Action> {
        if self.phase.is_expanded() && !self.cursor_is_inside() {
            self.leave_since.get_or_insert(now);
        }
        Vec::new()
    }

    fn on_monitor_changed(&mut self) -> Vec<Action> {
        vec![
            Action::SetWindowRect(self.rect_for_phase()),
            Action::EmitState(self.state()),
        ]
    }

    /// Replace the geometry (dock side switch, monitor or scale change).
    pub fn set_geometry(&mut self, geometry: DockGeometry) -> Vec<Action> {
        self.geometry = geometry;
        self.on_monitor_changed()
    }

    /// Brief 8.4 open sequence: resize first, then tell the frontend to slide in.
    /// Reversing out of `closing` skips the resize, since the window is already
    /// the expanded size.
    fn begin_open(&mut self, now: Instant, by_shortcut: bool) -> Vec<Action> {
        // Whatever reopens the panel ends the dismissal.
        self.dismissed = false;
        if by_shortcut {
            self.opened_deliberately_at = Some(now);
        }
        let was_expanded = self.phase.is_expanded();
        self.phase = Phase::Opening;
        self.hover_since = None;
        self.leave_since = None;
        self.ack_deadline = Some(now + self.timings.ack_timeout);
        if by_shortcut {
            self.opened_by_shortcut = true;
        }

        let mut actions = Vec::with_capacity(2);
        if !was_expanded {
            actions.push(Action::SetWindowRect(self.geometry.expanded_window_rect()));
        }
        actions.push(Action::EmitState(self.state()));
        actions
    }

    /// Close sequence: tell the frontend to slide out; the window shrinks only
    /// once it acknowledges, or when the acknowledgment times out.
    fn begin_close(&mut self, now: Instant) -> Vec<Action> {
        // Callers that mean "dismissed" set the flag themselves; an auto-close
        // from the cursor leaving must stay reversible on re-entry.
        self.phase = Phase::Closing;
        self.hover_since = None;
        self.ack_deadline = Some(now + self.timings.ack_timeout);
        vec![Action::EmitState(self.state())]
    }

    fn finish_close(&mut self) -> Vec<Action> {
        self.phase = Phase::Collapsed;
        self.opened_by_shortcut = false;
        self.opened_deliberately_at = None;
        self.leave_since = None;
        self.hover_since = None;
        self.ack_deadline = None;
        vec![
            Action::SetWindowRect(self.geometry.collapsed_window_rect()),
            Action::EmitState(self.state()),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dock::geometry::Metrics;

    const WORK: Rect = Rect::new(0, 40, 1920, 1040);

    fn controller() -> DockController {
        let geometry = DockGeometry::new(WORK, 1.0, Side::Right, 0.5, Metrics::default());
        DockController::new(geometry, Timings::default())
    }

    /// A fake clock: `Instant` supports adding a `Duration`, so tests advance
    /// time explicitly and never sleep.
    fn ms(base: Instant, millis: u64) -> Instant {
        base + Duration::from_millis(millis)
    }

    fn tab_point(c: &DockController) -> (f64, f64) {
        let tab = c.geometry().collapsed_tab_rect();
        (f64::from(tab.x + 10), f64::from(tab.y + 40))
    }

    fn panel_point(c: &DockController) -> (f64, f64) {
        let panel = c.geometry().panel_rect();
        (f64::from(panel.x + 100), f64::from(panel.y + 100))
    }

    const AWAY: (f64, f64) = (200.0, 500.0);

    fn hover_open(c: &mut DockController, t0: Instant) -> Vec<Action> {
        let (x, y) = tab_point(c);
        c.handle(Input::Cursor { x, y }, t0);
        let actions = c.tick(ms(t0, 120));
        c.handle(Input::AnimationDone(Phase::Opening), ms(t0, 130));
        actions
    }

    #[test]
    fn starts_collapsed_with_the_tab_sized_window() {
        let c = controller();
        assert_eq!(c.phase(), Phase::Collapsed);
        assert_eq!(c.state().tab_top, 0.0);
    }

    #[test]
    fn hover_intent_waits_for_the_open_delay() {
        let mut c = controller();
        let t0 = Instant::now();
        let (x, y) = tab_point(&c);

        c.handle(Input::Cursor { x, y }, t0);
        assert!(c.tick(ms(t0, 119)).is_empty());
        assert_eq!(c.phase(), Phase::Collapsed);

        let actions = c.tick(ms(t0, 120));
        assert_eq!(c.phase(), Phase::Opening);
        // Brief 8.4: resize first, then emit, so growing reveals nothing.
        assert_eq!(
            actions[0],
            Action::SetWindowRect(c.geometry().expanded_window_rect())
        );
        assert!(matches!(actions[1], Action::EmitState(s) if s.phase == Phase::Opening));
    }

    #[test]
    fn brushing_the_tab_does_not_open_it() {
        let mut c = controller();
        let t0 = Instant::now();
        let (x, y) = tab_point(&c);

        c.handle(Input::Cursor { x, y }, t0);
        c.handle(
            Input::Cursor {
                x: AWAY.0,
                y: AWAY.1,
            },
            ms(t0, 60),
        );
        assert!(c.tick(ms(t0, 200)).is_empty());
        assert_eq!(c.phase(), Phase::Collapsed);
    }

    #[test]
    fn slide_in_acknowledgment_completes_the_open() {
        let mut c = controller();
        let t0 = Instant::now();
        hover_open(&mut c, t0);
        assert_eq!(c.phase(), Phase::Open);
    }

    #[test]
    fn unacknowledged_open_still_reaches_open() {
        let mut c = controller();
        let t0 = Instant::now();
        let (x, y) = tab_point(&c);
        c.handle(Input::Cursor { x, y }, t0);
        c.tick(ms(t0, 120));
        assert_eq!(c.phase(), Phase::Opening);

        c.tick(ms(t0, 500));
        assert_eq!(c.phase(), Phase::Open);
    }

    #[test]
    fn leaving_closes_after_the_close_delay() {
        let mut c = controller();
        let t0 = Instant::now();
        hover_open(&mut c, t0);

        c.handle(
            Input::Cursor {
                x: AWAY.0,
                y: AWAY.1,
            },
            ms(t0, 200),
        );
        assert!(c.tick(ms(t0, 599)).is_empty());
        assert_eq!(c.phase(), Phase::Open);

        let actions = c.tick(ms(t0, 600));
        assert_eq!(c.phase(), Phase::Closing);
        // Emit only: the window must not shrink until the slide-out finishes.
        assert_eq!(actions.len(), 1);
        assert!(matches!(actions[0], Action::EmitState(s) if s.phase == Phase::Closing));
    }

    #[test]
    fn eight_pixel_tolerance_keeps_the_panel_open() {
        let mut c = controller();
        let t0 = Instant::now();
        hover_open(&mut c, t0);

        let panel = c.geometry().panel_rect();
        let just_outside = (f64::from(panel.x) - 5.0, f64::from(panel.y + 100));
        c.handle(
            Input::Cursor {
                x: just_outside.0,
                y: just_outside.1,
            },
            ms(t0, 200),
        );
        assert!(c.tick(ms(t0, 1000)).is_empty());
        assert_eq!(c.phase(), Phase::Open);
    }

    #[test]
    fn re_entry_during_closing_reverses_without_resizing() {
        let mut c = controller();
        let t0 = Instant::now();
        hover_open(&mut c, t0);

        c.handle(
            Input::Cursor {
                x: AWAY.0,
                y: AWAY.1,
            },
            ms(t0, 200),
        );
        c.tick(ms(t0, 600));
        assert_eq!(c.phase(), Phase::Closing);

        let (x, y) = panel_point(&c);
        let actions = c.handle(Input::Cursor { x, y }, ms(t0, 650));
        assert_eq!(c.phase(), Phase::Opening);
        // The window is already expanded, so no SetWindowRect.
        assert_eq!(actions.len(), 1);
        assert!(matches!(actions[0], Action::EmitState(s) if s.phase == Phase::Opening));
    }

    #[test]
    fn a_shortcut_opened_panel_ignores_the_blur_that_follows_it() {
        // macOS hands focus back to the previously active app moments after an
        // Accessory app activates itself. Brief 6.3 closes a shortcut-opened
        // panel when another app takes focus, so that bounce used to shut the
        // panel the instant the shortcut opened it.
        let mut c = controller();
        let t0 = Instant::now();

        c.handle(Input::Toggle, t0);
        assert_eq!(c.phase(), Phase::Opening);

        c.handle(Input::WindowBlurred, ms(t0, 900));
        assert_eq!(c.phase(), Phase::Opening);
        assert!(c.tick(ms(t0, 1_000)).is_empty());
    }

    #[test]
    fn an_explicit_dismissal_is_not_undone_by_a_cursor_that_never_left() {
        // Esc, the shortcut and the tray all dismiss outright. Brief 6.1 reverses
        // a close when the cursor *re-enters*, which presumes it left first: a
        // cursor sitting on the panel the whole time used to reopen it instantly,
        // so Esc did nothing, and with Keep open on nothing could dismiss it.
        let mut c = controller();
        let t0 = Instant::now();
        hover_open(&mut c, t0);

        let (x, y) = panel_point(&c);
        c.handle(Input::Cursor { x, y }, ms(t0, 200));
        c.handle(Input::Toggle, ms(t0, 210));
        assert_eq!(c.phase(), Phase::Closing);

        // The cursor has not moved, and must not resurrect the panel.
        c.handle(Input::Cursor { x, y }, ms(t0, 250));
        assert_eq!(c.phase(), Phase::Closing);

        c.handle(Input::AnimationDone(Phase::Closing), ms(t0, 350));
        assert_eq!(c.phase(), Phase::Collapsed);

        // Still resting on the tab: hover intent must stay suppressed.
        let (tx, ty) = tab_point(&c);
        c.handle(Input::Cursor { x: tx, y: ty }, ms(t0, 400));
        c.tick(ms(t0, 1_000));
        assert_eq!(c.phase(), Phase::Collapsed);
    }

    #[test]
    fn hover_works_again_once_the_cursor_leaves_after_a_dismissal() {
        let mut c = controller();
        let t0 = Instant::now();
        hover_open(&mut c, t0);

        let (x, y) = panel_point(&c);
        c.handle(Input::Cursor { x, y }, ms(t0, 200));
        c.handle(Input::Toggle, ms(t0, 210));
        c.handle(Input::AnimationDone(Phase::Closing), ms(t0, 350));
        assert_eq!(c.phase(), Phase::Collapsed);

        // Leaving ends the dismissal...
        c.handle(
            Input::Cursor {
                x: AWAY.0,
                y: AWAY.1,
            },
            ms(t0, 400),
        );
        // ...so coming back to the tab opens it normally again.
        let (tx, ty) = tab_point(&c);
        c.handle(Input::Cursor { x: tx, y: ty }, ms(t0, 500));
        c.tick(ms(t0, 700));
        assert_eq!(c.phase(), Phase::Opening);
    }

    #[test]
    fn an_auto_close_still_reverses_when_the_cursor_comes_back() {
        // Only an explicit dismissal suppresses the reversal; the cursor simply
        // leaving and returning must behave exactly as before.
        let mut c = controller();
        let t0 = Instant::now();
        hover_open(&mut c, t0);

        c.handle(
            Input::Cursor {
                x: AWAY.0,
                y: AWAY.1,
            },
            ms(t0, 200),
        );
        c.tick(ms(t0, 600));
        assert_eq!(c.phase(), Phase::Closing);

        let (x, y) = panel_point(&c);
        c.handle(Input::Cursor { x, y }, ms(t0, 650));
        assert_eq!(c.phase(), Phase::Opening);
    }

    #[test]
    fn close_acknowledgment_shrinks_the_window() {
        let mut c = controller();
        let t0 = Instant::now();
        hover_open(&mut c, t0);
        c.handle(
            Input::Cursor {
                x: AWAY.0,
                y: AWAY.1,
            },
            ms(t0, 200),
        );
        c.tick(ms(t0, 600));

        let actions = c.handle(Input::AnimationDone(Phase::Closing), ms(t0, 740));
        assert_eq!(c.phase(), Phase::Collapsed);
        assert_eq!(
            actions[0],
            Action::SetWindowRect(c.geometry().collapsed_window_rect())
        );
        assert!(matches!(actions[1], Action::EmitState(s) if s.phase == Phase::Collapsed));
    }

    #[test]
    fn close_shrinks_anyway_after_the_acknowledgment_timeout() {
        let mut c = controller();
        let t0 = Instant::now();
        hover_open(&mut c, t0);
        c.handle(
            Input::Cursor {
                x: AWAY.0,
                y: AWAY.1,
            },
            ms(t0, 200),
        );
        c.tick(ms(t0, 600));

        assert!(c.tick(ms(t0, 899)).is_empty());
        assert_eq!(c.phase(), Phase::Closing);

        let actions = c.tick(ms(t0, 900));
        assert_eq!(c.phase(), Phase::Collapsed);
        assert_eq!(
            actions[0],
            Action::SetWindowRect(c.geometry().collapsed_window_rect())
        );
    }

    #[test]
    fn a_late_acknowledgment_for_an_old_phase_is_ignored() {
        let mut c = controller();
        let t0 = Instant::now();
        hover_open(&mut c, t0);

        assert!(
            c.handle(Input::AnimationDone(Phase::Closing), ms(t0, 200))
                .is_empty()
        );
        assert_eq!(c.phase(), Phase::Open);
    }

    #[test]
    fn keep_open_prevents_auto_close() {
        let mut c = controller();
        let t0 = Instant::now();
        hover_open(&mut c, t0);

        let actions = c.handle(Input::SetKeepOpen(true), ms(t0, 150));
        assert!(matches!(actions[0], Action::EmitState(s) if s.keep_open));

        c.handle(
            Input::Cursor {
                x: AWAY.0,
                y: AWAY.1,
            },
            ms(t0, 200),
        );
        assert!(c.tick(ms(t0, 5_000)).is_empty());
        assert_eq!(c.phase(), Phase::Open);
    }

    #[test]
    fn turning_keep_open_off_restarts_the_close_delay() {
        let mut c = controller();
        let t0 = Instant::now();
        hover_open(&mut c, t0);
        c.handle(Input::SetKeepOpen(true), ms(t0, 150));
        c.handle(
            Input::Cursor {
                x: AWAY.0,
                y: AWAY.1,
            },
            ms(t0, 200),
        );
        c.tick(ms(t0, 5_000));

        c.handle(Input::SetKeepOpen(false), ms(t0, 5_000));
        assert!(c.tick(ms(t0, 5_399)).is_empty());
        assert_eq!(c.phase(), Phase::Open);
        c.tick(ms(t0, 5_400));
        assert_eq!(c.phase(), Phase::Closing);
    }

    #[test]
    fn interaction_lock_prevents_auto_close() {
        let mut c = controller();
        let t0 = Instant::now();
        hover_open(&mut c, t0);

        c.handle(Input::SetInteractionLock(true), ms(t0, 150));
        c.handle(
            Input::Cursor {
                x: AWAY.0,
                y: AWAY.1,
            },
            ms(t0, 200),
        );
        assert!(c.tick(ms(t0, 5_000)).is_empty());
        assert_eq!(c.phase(), Phase::Open);
    }

    #[test]
    fn releasing_the_interaction_lock_restarts_the_close_delay() {
        let mut c = controller();
        let t0 = Instant::now();
        hover_open(&mut c, t0);
        c.handle(Input::SetInteractionLock(true), ms(t0, 150));
        c.handle(
            Input::Cursor {
                x: AWAY.0,
                y: AWAY.1,
            },
            ms(t0, 200),
        );
        c.tick(ms(t0, 5_000));

        // Unlocking must not close immediately on the stale leave timestamp.
        c.handle(Input::SetInteractionLock(false), ms(t0, 5_000));
        assert!(c.tick(ms(t0, 5_399)).is_empty());
        c.tick(ms(t0, 5_400));
        assert_eq!(c.phase(), Phase::Closing);
    }

    #[test]
    fn toggle_opens_focused_and_ignores_the_cursor_leaving() {
        let mut c = controller();
        let t0 = Instant::now();

        let actions = c.handle(Input::Toggle, t0);
        assert_eq!(c.phase(), Phase::Opening);
        assert_eq!(
            actions[0],
            Action::SetWindowRect(c.geometry().expanded_window_rect())
        );
        assert_eq!(actions[2], Action::Focus);

        c.handle(Input::AnimationDone(Phase::Opening), ms(t0, 100));
        c.handle(
            Input::Cursor {
                x: AWAY.0,
                y: AWAY.1,
            },
            ms(t0, 200),
        );
        // Shortcut-opened panels stay put until Esc or another app takes focus.
        assert!(c.tick(ms(t0, 5_000)).is_empty());
        assert_eq!(c.phase(), Phase::Open);
    }

    #[test]
    fn toggle_closes_an_open_panel() {
        let mut c = controller();
        let t0 = Instant::now();
        hover_open(&mut c, t0);

        c.handle(Input::Toggle, ms(t0, 200));
        assert_eq!(c.phase(), Phase::Closing);
    }

    #[test]
    fn blur_closes_a_shortcut_opened_panel_immediately() {
        let mut c = controller();
        let t0 = Instant::now();
        c.handle(Input::Toggle, t0);
        c.handle(Input::AnimationDone(Phase::Opening), ms(t0, 100));

        // Past the settle window this is a real app switch, and brief 6.3 closes
        // on it at once — no close delay, unlike the cursor simply leaving.
        c.handle(Input::WindowBlurred, ms(t0, 2_000));
        assert_eq!(c.phase(), Phase::Closing);
    }

    #[test]
    fn blur_on_a_hover_opened_panel_starts_the_close_delay() {
        let mut c = controller();
        let t0 = Instant::now();
        hover_open(&mut c, t0);
        c.handle(
            Input::Cursor {
                x: AWAY.0,
                y: AWAY.1,
            },
            ms(t0, 150),
        );

        c.handle(Input::WindowBlurred, ms(t0, 200));
        assert_eq!(c.phase(), Phase::Open);
        c.tick(ms(t0, 600));
        assert_eq!(c.phase(), Phase::Closing);
    }

    #[test]
    fn blur_clears_a_stuck_interaction_lock() {
        let mut c = controller();
        let t0 = Instant::now();
        hover_open(&mut c, t0);
        c.handle(Input::SetInteractionLock(true), ms(t0, 150));
        c.handle(
            Input::Cursor {
                x: AWAY.0,
                y: AWAY.1,
            },
            ms(t0, 200),
        );

        // Another app has focus, so our text field cannot still hold it.
        c.handle(Input::WindowBlurred, ms(t0, 250));
        c.tick(ms(t0, 700));
        assert_eq!(c.phase(), Phase::Closing);
    }

    #[test]
    fn blur_respects_keep_open() {
        let mut c = controller();
        let t0 = Instant::now();
        hover_open(&mut c, t0);
        c.handle(Input::SetKeepOpen(true), ms(t0, 150));

        c.handle(Input::WindowBlurred, ms(t0, 200));
        assert!(c.tick(ms(t0, 5_000)).is_empty());
        assert_eq!(c.phase(), Phase::Open);
    }

    #[test]
    fn pointer_left_webview_is_a_secondary_close_signal() {
        let mut c = controller();
        let t0 = Instant::now();
        hover_open(&mut c, t0);

        // Linux: the polled cursor can go stale, so the webview event stands in.
        c.handle(
            Input::Cursor {
                x: AWAY.0,
                y: AWAY.1,
            },
            ms(t0, 150),
        );
        c.handle(Input::PointerLeftWebview, ms(t0, 200));
        c.tick(ms(t0, 600));
        assert_eq!(c.phase(), Phase::Closing);
    }

    #[test]
    fn monitor_change_reapplies_the_rect_for_the_current_phase() {
        let mut c = controller();
        let t0 = Instant::now();

        let actions = c.handle(Input::MonitorChanged, t0);
        assert_eq!(
            actions[0],
            Action::SetWindowRect(c.geometry().collapsed_window_rect())
        );

        hover_open(&mut c, t0);
        let actions = c.handle(Input::MonitorChanged, ms(t0, 200));
        assert_eq!(
            actions[0],
            Action::SetWindowRect(c.geometry().expanded_window_rect())
        );
    }

    #[test]
    fn switching_side_re_emits_geometry() {
        let mut c = controller();
        let left = DockGeometry::new(WORK, 1.0, Side::Left, 0.5, Metrics::default());

        let actions = c.set_geometry(left);
        assert_eq!(c.geometry().side(), Side::Left);
        assert!(matches!(actions[1], Action::EmitState(s) if s.side == Side::Left));
    }

    #[test]
    fn poll_interval_adapts_to_cursor_proximity() {
        let mut c = controller();
        let t0 = Instant::now();
        assert_eq!(c.poll_interval(), Duration::from_millis(150));

        c.handle(
            Input::Cursor {
                x: 1900.0,
                y: 500.0,
            },
            t0,
        );
        assert_eq!(c.poll_interval(), Duration::from_millis(33));

        c.handle(Input::Cursor { x: 400.0, y: 500.0 }, ms(t0, 10));
        assert_eq!(c.poll_interval(), Duration::from_millis(150));

        hover_open(&mut c, ms(t0, 20));
        assert_eq!(c.poll_interval(), Duration::from_millis(33));
    }

    #[test]
    fn state_reports_tab_top_only_while_expanded() {
        let mut c = controller();
        let t0 = Instant::now();
        assert_eq!(c.state().tab_top, 0.0);

        hover_open(&mut c, t0);
        assert_eq!(c.state().tab_top, c.geometry().tab_top_logical());
    }
}
