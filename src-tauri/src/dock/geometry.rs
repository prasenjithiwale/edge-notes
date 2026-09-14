//! Pure window geometry for the dock.
//!
//! Everything here is in physical pixels and desktop coordinates (origin at the
//! primary monitor's top-left, so negative origins are normal). Logical sizes
//! from the brief are converted once, here, using the target monitor's scale
//! factor. Nothing in this module touches Tauri, so it is fully unit-testable.

use serde::{Deserialize, Serialize};

/// Which screen edge the dock is attached to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Left,
    Right,
}

impl Side {
    #[must_use]
    pub fn opposite(self) -> Self {
        match self {
            Self::Left => Self::Right,
            Self::Right => Self::Left,
        }
    }
}

/// A rectangle in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    #[must_use]
    pub const fn new(x: i32, y: i32, width: u32, height: u32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    #[must_use]
    pub fn right(&self) -> i32 {
        self.x
            .saturating_add(i32::try_from(self.width).unwrap_or(i32::MAX))
    }

    #[must_use]
    pub fn bottom(&self) -> i32 {
        self.y
            .saturating_add(i32::try_from(self.height).unwrap_or(i32::MAX))
    }

    /// Hit test with a tolerance band in physical pixels, per brief 6.2.
    #[must_use]
    pub fn contains(&self, x: f64, y: f64, tolerance: i32) -> bool {
        let t = f64::from(tolerance);
        x >= f64::from(self.x) - t
            && x <= f64::from(self.right()) + t
            && y >= f64::from(self.y) - t
            && y <= f64::from(self.bottom()) + t
    }
}

/// Logical-pixel design constants from brief 6.4 and 8.7.
#[derive(Debug, Clone, Copy)]
pub struct Metrics {
    pub tab_width: f64,
    pub tab_height: f64,
    pub panel_width: f64,
    pub panel_max_height: f64,
    pub panel_height_ratio: f64,
    /// Transparent room for the panel's shadow on the three sides away from the edge.
    pub shadow_margin: f64,
    /// The large panel a note expands into: at most this wide...
    pub large_panel_max_width: f64,
    /// ...or this share of the work-area width, whichever is narrower.
    pub large_panel_width_ratio: f64,
    /// The large panel's share of the work-area height, uncapped.
    pub large_panel_height_ratio: f64,
}

impl Default for Metrics {
    fn default() -> Self {
        Self {
            // The tab's window and hit area. The visible tab is a smaller floating
            // pill drawn inside it (`Tab.module.css`); the rest is room for its
            // shadow and the gap to the edge, and still counts as the tab, so a
            // cursor thrown against the screen edge lands on it.
            tab_width: 22.0,
            tab_height: 72.0,
            panel_width: 320.0,
            panel_max_height: 640.0,
            panel_height_ratio: 0.8,
            shadow_margin: 12.0,
            large_panel_max_width: 760.0,
            large_panel_width_ratio: 0.6,
            large_panel_height_ratio: 0.9,
        }
    }
}

/// Resolves the dock's rectangles for one monitor.
#[derive(Debug, Clone, Copy)]
pub struct DockGeometry {
    work_area: Rect,
    scale: f64,
    side: Side,
    tab_offset: f64,
    metrics: Metrics,
    /// An expanded note: the panel grows so a long note can be read and edited
    /// comfortably. Everything else — the docked edge, the tab, hit testing —
    /// follows from the bigger panel rect.
    large: bool,
}

impl DockGeometry {
    #[must_use]
    pub fn new(work_area: Rect, scale: f64, side: Side, tab_offset: f64, metrics: Metrics) -> Self {
        Self {
            work_area,
            scale: if scale > 0.0 { scale } else { 1.0 },
            side,
            tab_offset: tab_offset.clamp(0.0, 1.0),
            metrics,
            large: false,
        }
    }

    #[must_use]
    pub fn is_large(&self) -> bool {
        self.large
    }

    /// Same dock, with the panel at its large or its normal size.
    #[must_use]
    pub fn with_large(&self, large: bool) -> Self {
        Self { large, ..*self }
    }

    #[must_use]
    pub fn side(&self) -> Side {
        self.side
    }

    #[must_use]
    pub fn work_area(&self) -> Rect {
        self.work_area
    }

    #[must_use]
    pub fn scale(&self) -> f64 {
        self.scale
    }

    #[must_use]
    pub fn tab_offset(&self) -> f64 {
        self.tab_offset
    }

    /// Same dock, new vertical position along the edge (brief M4's tab drag).
    #[must_use]
    pub fn with_tab_offset(&self, tab_offset: f64) -> Self {
        Self::new(
            self.work_area,
            self.scale,
            self.side,
            tab_offset,
            self.metrics,
        )
        .with_large(self.large)
    }

    /// The offset that puts the tab's centre at `centre_y` (physical, desktop
    /// coordinates), for dragging the tab along the edge.
    ///
    /// Clamped to the range that keeps the tab fully inside the work area, so the
    /// stored ratio always matches where the tab actually is. Clamping only the
    /// pixels would let the ratio drift past the end, and dragging back would do
    /// nothing until the drift was used up.
    #[must_use]
    pub fn tab_offset_for_centre(&self, centre_y: f64) -> f64 {
        let height = f64::from(self.work_area.height as i32);
        if height <= 0.0 {
            return 0.5;
        }
        let half_tab = f64::from(self.tab_h()) / 2.0;
        let ratio = (centre_y - f64::from(self.work_area.y)) / height;
        // Brief 8.5 stores the position as a ratio so it survives a resolution
        // change; the limits are a ratio for the same reason.
        ratio.clamp(half_tab / height, 1.0 - half_tab / height)
    }

    /// Same dock, new monitor: keeps the side, tab offset and metrics so the tab
    /// stays where the user put it across resolution and scale changes.
    #[must_use]
    pub fn with_monitor(&self, work_area: Rect, scale: f64) -> Self {
        Self::new(work_area, scale, self.side, self.tab_offset, self.metrics).with_large(self.large)
    }

    /// Same monitor, other edge.
    #[must_use]
    pub fn with_side(&self, side: Side) -> Self {
        Self::new(
            self.work_area,
            self.scale,
            side,
            self.tab_offset,
            self.metrics,
        )
        .with_large(self.large)
    }

    /// Logical pixels to physical, rounded to the nearest device pixel.
    fn px(&self, logical: f64) -> i32 {
        (logical * self.scale).round() as i32
    }

    fn px_u32(&self, logical: f64) -> u32 {
        self.px(logical).max(0) as u32
    }

    fn tab_w(&self) -> i32 {
        self.px(self.metrics.tab_width)
    }

    fn tab_h(&self) -> i32 {
        self.px(self.metrics.tab_height)
    }

    fn panel_w(&self) -> i32 {
        let normal = self.px(self.metrics.panel_width);
        if !self.large {
            return normal;
        }
        let work_w = self.work_area.width as i32;
        let by_ratio = (f64::from(work_w) * self.metrics.large_panel_width_ratio).round() as i32;
        let wanted = by_ratio.min(self.px(self.metrics.large_panel_max_width));
        // Never narrower than the normal panel, and never so wide that the window
        // (tab and shadow margin included) would leave the work area.
        let room = work_w - self.tab_w() - self.margin();
        wanted.max(normal).min(room).max(1)
    }

    /// The panel width in logical pixels, which the frontend paints to.
    #[must_use]
    pub fn panel_width_logical(&self) -> f64 {
        f64::from(self.panel_w()) / self.scale
    }

    fn margin(&self) -> i32 {
        self.px(self.metrics.shadow_margin)
    }

    /// Panel height: `min(640, 80% of the work-area height)`, per brief 6.4, or
    /// 90% of the work area when a note is expanded.
    fn panel_h(&self) -> i32 {
        if self.large {
            let work_h = self.work_area.height as i32;
            let by_ratio =
                (f64::from(work_h) * self.metrics.large_panel_height_ratio).round() as i32;
            return by_ratio.min(work_h - self.margin() * 2).max(1);
        }
        let ratio_based = f64::from(self.work_area.height as i32) * self.metrics.panel_height_ratio;
        let capped = self.px(self.metrics.panel_max_height);
        (ratio_based.round() as i32).min(capped).max(1)
    }

    /// Top of the tab in desktop coordinates, clamped inside the work area.
    fn tab_y(&self) -> i32 {
        let centre =
            f64::from(self.work_area.y) + f64::from(self.work_area.height as i32) * self.tab_offset;
        let top = (centre - f64::from(self.tab_h()) / 2.0).round() as i32;
        top.clamp(self.work_area.y, self.work_area.bottom() - self.tab_h())
    }

    fn tab_centre_y(&self) -> i32 {
        self.tab_y() + self.tab_h() / 2
    }

    /// The tab where it sits while collapsed: flush against the screen edge.
    #[must_use]
    pub fn collapsed_tab_rect(&self) -> Rect {
        let x = match self.side {
            Side::Right => self.work_area.right() - self.tab_w(),
            Side::Left => self.work_area.x,
        };
        Rect::new(
            x,
            self.tab_y(),
            self.px_u32(self.metrics.tab_width),
            self.px_u32(self.metrics.tab_height),
        )
    }

    /// The collapsed window is exactly the tab, so clicks miss it everywhere else.
    #[must_use]
    pub fn collapsed_window_rect(&self) -> Rect {
        self.collapsed_tab_rect()
    }

    /// The expanded window: panel, tab, and a transparent shadow margin on the
    /// three sides away from the screen edge (brief 8.7).
    #[must_use]
    pub fn expanded_window_rect(&self) -> Rect {
        let width = self.margin() + self.tab_w() + self.panel_w();
        let height = self.panel_h() + self.margin() * 2;
        let x = match self.side {
            Side::Right => self.work_area.right() - width,
            Side::Left => self.work_area.x,
        };
        let desired_y = self.tab_centre_y() - height / 2;
        let y = desired_y.clamp(
            self.work_area.y,
            (self.work_area.bottom() - height).max(self.work_area.y),
        );
        Rect::new(x, y, width.max(0) as u32, height.max(0) as u32)
    }

    /// The panel itself while open: flush to the screen edge, inside the margins.
    #[must_use]
    pub fn panel_rect(&self) -> Rect {
        let window = self.expanded_window_rect();
        let x = match self.side {
            Side::Right => window.right() - self.panel_w(),
            Side::Left => window.x,
        };
        Rect::new(
            x,
            window.y + self.margin(),
            self.panel_w().max(0) as u32,
            self.panel_h().max(0) as u32,
        )
    }

    /// The tab while open: attached to the panel's inner edge, so it has moved
    /// inward by one panel width from its collapsed position.
    #[must_use]
    pub fn open_tab_rect(&self) -> Rect {
        let panel = self.panel_rect();
        let x = match self.side {
            Side::Right => panel.x - self.tab_w(),
            Side::Left => panel.right(),
        };
        Rect::new(
            x,
            self.tab_y(),
            self.px_u32(self.metrics.tab_width),
            self.px_u32(self.metrics.tab_height),
        )
    }

    /// The tab's offset from the top of the expanded window, in logical pixels.
    ///
    /// The frontend needs this because the panel is centred on the tab and then
    /// clamped, so near the top or bottom of the screen the tab is *not* centred
    /// on the panel. Sending it keeps the tab from jumping when the window grows.
    #[must_use]
    pub fn tab_top_logical(&self) -> f64 {
        let window = self.expanded_window_rect();
        let max = (i32::try_from(window.height).unwrap_or(i32::MAX) - self.tab_h()).max(0);
        let offset = (self.tab_y() - window.y).clamp(0, max);
        f64::from(offset) / self.scale
    }

    /// Hit area while collapsed: the tab only.
    #[must_use]
    pub fn hit_collapsed(&self, x: f64, y: f64, tolerance_logical: f64) -> bool {
        self.collapsed_tab_rect()
            .contains(x, y, self.px(tolerance_logical))
    }

    /// Hit area while open: the panel or the tab, never the transparent margin
    /// (brief 8.7 — hit-testing uses the panel rect, not the window rect).
    #[must_use]
    pub fn hit_open(&self, x: f64, y: f64, tolerance_logical: f64) -> bool {
        let t = self.px(tolerance_logical);
        self.panel_rect().contains(x, y, t) || self.open_tab_rect().contains(x, y, t)
    }

    /// Is the cursor close enough to the docked edge to justify fast polling?
    #[must_use]
    pub fn near_edge(&self, x: f64, y: f64, distance_logical: f64) -> bool {
        let d = f64::from(self.px(distance_logical));
        let within_vertical =
            y >= f64::from(self.work_area.y) && y <= f64::from(self.work_area.bottom());
        if !within_vertical {
            return false;
        }
        match self.side {
            Side::Right => x >= f64::from(self.work_area.right()) - d,
            Side::Left => x <= f64::from(self.work_area.x) + d,
        }
    }
}

/// Which call to make first when moving and resizing the window.
///
/// Tauri 2.11 has no atomic bounds API (verified against the crate source), so a
/// right dock — where `x + width` must stay pinned to the screen edge — needs two
/// calls. Applying the one that keeps the window on screen first means a stray
/// intermediate frame shows the tab slightly misplaced rather than off screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApplyOrder {
    MoveThenResize,
    ResizeThenMove,
}

#[must_use]
pub fn apply_order(current: Rect, target: Rect) -> ApplyOrder {
    if target.width >= current.width {
        ApplyOrder::MoveThenResize
    } else {
        ApplyOrder::ResizeThenMove
    }
}

/// Whether the window manager put the window where it was asked, give or take a
/// pixel for rounding between physical and logical pixels. On Linux moves and
/// resizes land asynchronously and a window manager may adjust them, so the
/// placement is checked rather than assumed.
#[must_use]
pub fn rect_settled(actual: Rect, target: Rect) -> bool {
    (actual.x - target.x).abs() <= 1
        && (actual.y - target.y).abs() <= 1
        && actual.width.abs_diff(target.width) <= 1
        && actual.height.abs_diff(target.height) <= 1
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 1920x1080 monitor at the origin with a 40px taskbar/menu bar at the top.
    fn work_area() -> Rect {
        Rect::new(0, 40, 1920, 1040)
    }

    fn geom(side: Side, scale: f64, offset: f64) -> DockGeometry {
        DockGeometry::new(work_area(), scale, side, offset, Metrics::default())
    }

    #[test]
    fn collapsed_window_is_exactly_the_tab() {
        let g = geom(Side::Right, 1.0, 0.5);
        assert_eq!(g.collapsed_window_rect(), g.collapsed_tab_rect());
        assert_eq!(g.collapsed_window_rect().width, 22);
        assert_eq!(g.collapsed_window_rect().height, 72);
    }

    #[test]
    fn right_dock_sits_flush_against_the_right_edge() {
        let g = geom(Side::Right, 1.0, 0.5);
        assert_eq!(g.collapsed_tab_rect().right(), 1920);
        assert_eq!(g.panel_rect().right(), 1920);
        assert_eq!(g.expanded_window_rect().right(), 1920);
    }

    #[test]
    fn left_dock_mirrors_the_right_dock() {
        let right = geom(Side::Right, 1.0, 0.5);
        let left = geom(Side::Left, 1.0, 0.5);

        assert_eq!(left.collapsed_tab_rect().x, 0);
        assert_eq!(left.panel_rect().x, 0);
        assert_eq!(left.expanded_window_rect().x, 0);

        // Same sizes, mirrored positions.
        assert_eq!(
            left.expanded_window_rect().width,
            right.expanded_window_rect().width
        );
        assert_eq!(left.panel_rect().width, right.panel_rect().width);
        assert_eq!(left.tab_top_logical(), right.tab_top_logical());
    }

    #[test]
    fn open_tab_attaches_to_the_panel_inner_edge() {
        let right = geom(Side::Right, 1.0, 0.5);
        assert_eq!(right.open_tab_rect().right(), right.panel_rect().x);

        let left = geom(Side::Left, 1.0, 0.5);
        assert_eq!(left.open_tab_rect().x, left.panel_rect().right());
    }

    /// The core no-flicker invariant from brief 8.4: the expanded window shares
    /// its docked edge with the collapsed window, so a group anchored to that
    /// edge and translated one panel width outward lands on the same pixels.
    #[test]
    fn docked_edge_is_identical_collapsed_and_expanded() {
        for side in [Side::Left, Side::Right] {
            for scale in [1.0, 1.5, 2.0] {
                let g = geom(side, scale, 0.5);
                let collapsed = g.collapsed_window_rect();
                let expanded = g.expanded_window_rect();
                match side {
                    Side::Right => assert_eq!(collapsed.right(), expanded.right()),
                    Side::Left => assert_eq!(collapsed.x, expanded.x),
                }
                // Translating the open tab outward by one panel width returns it
                // to the collapsed tab position.
                let panel_w = (320.0 * scale).round() as i32;
                let translated = match side {
                    Side::Right => g.open_tab_rect().x + panel_w,
                    Side::Left => g.open_tab_rect().x - panel_w,
                };
                assert_eq!(translated, collapsed.x, "side {side:?} scale {scale}");
            }
        }
    }

    #[test]
    fn scale_factors_convert_logical_to_physical() {
        for (scale, tab_w, panel_w, margin) in
            [(1.0, 22, 320, 12), (1.5, 33, 480, 18), (2.0, 44, 640, 24)]
        {
            let g = geom(Side::Right, scale, 0.5);
            assert_eq!(g.collapsed_tab_rect().width, tab_w, "scale {scale}");
            assert_eq!(g.panel_rect().width, panel_w, "scale {scale}");
            assert_eq!(
                g.expanded_window_rect().width,
                margin + tab_w + panel_w,
                "scale {scale}"
            );
        }
    }

    #[test]
    fn panel_height_is_capped_at_640_logical() {
        // 1040 physical work-area height: 80% is 832, so the 640 cap wins.
        let g = geom(Side::Right, 1.0, 0.5);
        assert_eq!(g.panel_rect().height, 640);

        // At 2x the cap is 1280 physical, so the 80% rule wins instead.
        let g2 = geom(Side::Right, 2.0, 0.5);
        assert_eq!(g2.panel_rect().height, 832);
    }

    #[test]
    fn short_screens_use_eighty_percent_of_the_work_area() {
        let g = DockGeometry::new(
            Rect::new(0, 0, 1280, 600),
            1.0,
            Side::Right,
            0.5,
            Metrics::default(),
        );
        assert_eq!(g.panel_rect().height, 480);
    }

    #[test]
    fn tab_clamps_inside_the_work_area_at_both_extremes() {
        let top = geom(Side::Right, 1.0, 0.0);
        assert_eq!(top.collapsed_tab_rect().y, 40);
        assert!(top.expanded_window_rect().y >= 40);

        let bottom = geom(Side::Right, 1.0, 1.0);
        assert_eq!(bottom.collapsed_tab_rect().bottom(), 1080);
        assert!(bottom.expanded_window_rect().bottom() <= 1080);
    }

    /// Near the edges the panel is clamped, so the tab is no longer centred on
    /// it — which is exactly why `tabTop` is part of the dock:state payload.
    #[test]
    fn tab_top_tracks_the_clamped_panel() {
        let centred = geom(Side::Right, 1.0, 0.5);
        let window = centred.expanded_window_rect();
        let expected = f64::from(centred.collapsed_tab_rect().y - window.y);
        assert!((centred.tab_top_logical() - expected).abs() < f64::EPSILON);

        let top = geom(Side::Right, 1.0, 0.0);
        assert_eq!(top.tab_top_logical(), 0.0);

        let bottom = geom(Side::Right, 1.0, 1.0);
        let w = bottom.expanded_window_rect();
        assert_eq!(bottom.tab_top_logical(), f64::from(w.height as i32 - 72));
    }

    #[test]
    fn tab_top_is_reported_in_logical_pixels() {
        let g = geom(Side::Right, 2.0, 0.5);
        let window = g.expanded_window_rect();
        let physical = f64::from(g.collapsed_tab_rect().y - window.y);
        assert!((g.tab_top_logical() - physical / 2.0).abs() < f64::EPSILON);
    }

    /// Displays placed left of or above the primary monitor have negative origins.
    #[test]
    fn negative_monitor_origins_are_handled() {
        let secondary = Rect::new(-1680, -300, 1680, 1050);
        let g = DockGeometry::new(secondary, 1.0, Side::Right, 0.5, Metrics::default());

        assert_eq!(g.collapsed_tab_rect().right(), 0);
        assert_eq!(g.panel_rect().right(), 0);
        assert_eq!(g.expanded_window_rect().x, -354);
        // Centred on a monitor spanning y -300..750, so the tab's centre sits at
        // +225 and its top half a tab above.
        assert_eq!(g.collapsed_tab_rect().y, 189);
        assert!(g.expanded_window_rect().y >= -300);
        assert!(g.expanded_window_rect().bottom() <= 750);

        // High on that monitor the tab really does land at a negative y.
        let high = DockGeometry::new(secondary, 1.0, Side::Right, 0.1, Metrics::default());
        assert!(high.collapsed_tab_rect().y < 0);
        assert!(high.collapsed_tab_rect().y >= -300);
        assert!(high.expanded_window_rect().y >= -300);

        let left = DockGeometry::new(secondary, 1.0, Side::Left, 0.5, Metrics::default());
        assert_eq!(left.collapsed_tab_rect().x, -1680);
        assert_eq!(left.expanded_window_rect().x, -1680);
    }

    #[test]
    fn negative_origins_survive_fractional_scaling() {
        let secondary = Rect::new(-2560, -100, 2560, 1440);
        let g = DockGeometry::new(secondary, 1.5, Side::Right, 0.25, Metrics::default());
        assert_eq!(g.collapsed_tab_rect().right(), 0);
        assert_eq!(g.expanded_window_rect().right(), 0);
        assert!(g.hit_collapsed(-20.0, f64::from(g.collapsed_tab_rect().y + 10), 0.0));
    }

    #[test]
    fn hit_testing_ignores_the_transparent_shadow_margin() {
        let g = geom(Side::Right, 1.0, 0.5);
        let window = g.expanded_window_rect();
        let panel = g.panel_rect();

        // A point inside the window but in the left shadow margin, above the tab.
        let margin_x = f64::from(window.x + 4);
        let margin_y = f64::from(window.y + 4);
        assert!(!g.hit_open(margin_x, margin_y, 0.0));

        // Dead centre of the panel hits.
        assert!(g.hit_open(f64::from(panel.x + 100), f64::from(panel.y + 100), 0.0));

        // The tab hits while open.
        let tab = g.open_tab_rect();
        assert!(g.hit_open(f64::from(tab.x + 10), f64::from(tab.y + 10), 0.0));
    }

    #[test]
    fn close_tolerance_widens_the_hit_area() {
        let g = geom(Side::Right, 1.0, 0.5);
        let panel = g.panel_rect();
        let just_outside = f64::from(panel.y) - 5.0;
        let x = f64::from(panel.x + 100);

        assert!(!g.hit_open(x, just_outside, 0.0));
        assert!(g.hit_open(x, just_outside, 8.0));
    }

    #[test]
    fn collapsed_hit_area_is_only_the_tab() {
        let g = geom(Side::Right, 1.0, 0.5);
        let tab = g.collapsed_tab_rect();
        assert!(g.hit_collapsed(f64::from(tab.x + 10), f64::from(tab.y + 10), 0.0));
        // 200px left of the edge is where the panel would be, but nothing is there.
        assert!(!g.hit_collapsed(f64::from(tab.x - 200), f64::from(tab.y + 10), 0.0));
        // Above the tab, still at the edge.
        assert!(!g.hit_collapsed(f64::from(tab.x + 10), f64::from(tab.y - 40), 0.0));
    }

    #[test]
    fn near_edge_drives_the_fast_poll_band() {
        let g = geom(Side::Right, 1.0, 0.5);
        assert!(g.near_edge(1900.0, 500.0, 150.0));
        assert!(g.near_edge(1771.0, 500.0, 150.0));
        assert!(!g.near_edge(1600.0, 500.0, 150.0));
        // Outside the monitor vertically.
        assert!(!g.near_edge(1900.0, 2000.0, 150.0));

        let left = geom(Side::Left, 1.0, 0.5);
        assert!(left.near_edge(20.0, 500.0, 150.0));
        assert!(!left.near_edge(400.0, 500.0, 150.0));
    }

    #[test]
    fn a_large_panel_is_capped_in_width_and_fills_most_of_the_height() {
        // 60% of 1920 is 1152, so the 760 logical cap wins; 90% of 1040 is 936.
        let g = geom(Side::Right, 1.0, 0.5).with_large(true);
        assert_eq!(g.panel_rect().width, 760);
        assert_eq!(g.panel_rect().height, 936);
        assert!((g.panel_width_logical() - 760.0).abs() < f64::EPSILON);

        // Still flush to the docked edge, with the tab on its inner side.
        let window = g.expanded_window_rect();
        assert_eq!(window.right(), work_area().right());
        assert_eq!(g.open_tab_rect().x, g.panel_rect().x - 22);
        assert!(window.y >= work_area().y && window.bottom() <= work_area().bottom());
    }

    #[test]
    fn a_large_panel_follows_the_scale_factor_and_small_screens() {
        // At 2x the cap is 1520 physical, but 60% of the width (1152) is narrower.
        let g = geom(Side::Left, 2.0, 0.5).with_large(true);
        assert_eq!(g.panel_rect().width, 1152);
        assert!((g.panel_width_logical() - 576.0).abs() < f64::EPSILON);
        assert_eq!(g.expanded_window_rect().x, work_area().x);

        // On a screen too narrow for 60% to beat the normal panel, it stays normal
        // rather than shrinking.
        let narrow = DockGeometry::new(
            Rect::new(0, 0, 400, 800),
            1.0,
            Side::Right,
            0.5,
            Metrics::default(),
        )
        .with_large(true);
        assert_eq!(narrow.panel_rect().width, 320);
    }

    #[test]
    fn rebuilding_the_geometry_keeps_the_large_panel() {
        let g = geom(Side::Right, 1.0, 0.5).with_large(true);
        assert!(g.with_side(Side::Left).is_large());
        assert!(g.with_tab_offset(0.2).is_large());
        assert!(g.with_monitor(work_area(), 1.5).is_large());
        assert!(!g.with_large(false).is_large());
        // A fresh geometry never starts large.
        assert!(!geom(Side::Right, 1.0, 0.5).is_large());
    }

    #[test]
    fn a_rect_is_settled_within_a_pixel_and_not_beyond() {
        let target = Rect::new(1898, 504, 22, 72);
        assert!(rect_settled(target, target));
        assert!(rect_settled(Rect::new(1899, 503, 23, 71), target));
        // The Kubuntu report: the tab left where the open panel's edge had been.
        assert!(!rect_settled(Rect::new(1566, 504, 22, 72), target));
        assert!(!rect_settled(Rect::new(1898, 504, 354, 72), target));
    }

    #[test]
    fn apply_order_keeps_the_window_on_screen() {
        let small = Rect::new(1898, 100, 22, 72);
        let large = Rect::new(1560, 60, 360, 664);
        assert_eq!(apply_order(small, large), ApplyOrder::MoveThenResize);
        assert_eq!(apply_order(large, small), ApplyOrder::ResizeThenMove);
    }
}
