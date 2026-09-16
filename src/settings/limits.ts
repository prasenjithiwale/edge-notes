/**
 * The ranges the settings view allows, and the clamp that keeps a half-typed or
 * pasted value from reaching Rust. Pure, so the bounds are testable on their own.
 */
export interface Range {
  min: number;
  max: number;
  fallback: number;
}

/** Brief 6.4: the panel is 320 px, later configurable between 280 and 420. */
export const PANEL_WIDTH: Range = { min: 280, max: 420, fallback: 320 };

/**
 * How see-through the panel can be made. Beyond 60 % notes over a busy desktop
 * stop being readable, since there is no blur behind the panel. Rust clamps to
 * the same bound (`MAX_PANEL_TRANSLUCENCY`).
 */
export const PANEL_TRANSLUCENCY: Range = { min: 0, max: 60, fallback: 0 };

/** Brief 6.2 defaults, with room to tune either way. */
export const DELAY: { open: Range; close: Range } = {
  open: { min: 0, max: 1_000, fallback: 120 },
  close: { min: 0, max: 5_000, fallback: 400 },
};

/**
 * The Focus tab's phase lengths, in minutes, and the run that earns the long
 * break. Rust clamps to the same bounds (`FOCUS_MINUTES`, `LONG_BREAK_EVERY`):
 * a minute is a fair way to test the notification, and past two hours it is not
 * a pomodoro.
 */
export const FOCUS_MINUTES: Range = { min: 1, max: 120, fallback: 25 };
export const LONG_BREAK_EVERY: Range = { min: 2, max: 8, fallback: 4 };

/**
 * A number input reports "" while it is being cleared, and anything typed can be
 * out of range; both fall back rather than sending nonsense to Rust, which would
 * reject it anyway.
 */
export function clampSetting(raw: string, range: Range): number {
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) {
    return range.fallback;
  }
  return Math.min(Math.max(value, range.min), range.max);
}
