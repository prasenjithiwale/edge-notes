import { describe, expect, it } from "vitest";

import {
  advance,
  DURATIONS,
  dots,
  formatRemaining,
  hasElapsed,
  idle,
  isRunning,
  pause,
  progress,
  remaining,
  reset,
  start,
} from "./pomodoro";

const NOW = 1_800_000_000_000;
const DAY = "2026-09-16";

describe("running the clock", () => {
  it("starts from a full phase and counts down against the wall clock", () => {
    const started = start(idle(), NOW);
    expect(isRunning(started)).toBe(true);
    expect(remaining(started, NOW)).toBe(DURATIONS.focus);
    expect(remaining(started, NOW + 60_000)).toBe(DURATIONS.focus - 60_000);
  });

  /**
   * The point of keeping the end rather than a counter: nothing has to have been
   * running for the answer to be right.
   */
  it("is right after a long gap with nothing running", () => {
    const started = start(idle(), NOW);
    expect(remaining(started, NOW + DURATIONS.focus + 600_000)).toBe(0);
    expect(hasElapsed(started, NOW + DURATIONS.focus)).toBe(true);
  });

  it("keeps what is left when paused, and picks it up again", () => {
    const paused = pause(start(idle(), NOW), NOW + 60_000);
    expect(isRunning(paused)).toBe(false);
    expect(remaining(paused, NOW + 300_000)).toBe(DURATIONS.focus - 60_000);

    const resumed = start(paused, NOW + 300_000);
    expect(remaining(resumed, NOW + 300_000)).toBe(DURATIONS.focus - 60_000);
    expect(remaining(resumed, NOW + 360_000)).toBe(DURATIONS.focus - 120_000);
  });

  it("does nothing when told to start something already running", () => {
    const started = start(idle(), NOW);
    expect(start(started, NOW + 5_000)).toBe(started);
  });

  it("starts a phase that has run out from the top rather than at zero", () => {
    const spent = { ...idle(), restMs: 0 };
    expect(remaining(start(spent, NOW), NOW)).toBe(DURATIONS.focus);
  });

  it("resets to the whole phase, stopped", () => {
    const back = reset(pause(start(idle(), NOW), NOW + 60_000));
    expect(isRunning(back)).toBe(false);
    expect(remaining(back, NOW)).toBe(DURATIONS.focus);
  });
});

describe("phases", () => {
  it("earns a short break, and the long one every fourth time", () => {
    let state = idle();
    for (let session = 1; session <= 3; session += 1) {
      state = advance(state, DAY, true);
      expect(state.phase).toBe("short");
      expect(state.streak).toBe(session);
      state = advance(state, DAY, true);
      expect(state.phase).toBe("focus");
    }
    state = advance(state, DAY, true);
    expect(state.phase).toBe("long");
    expect(state.streak).toBe(4);
  });

  it("does not count a focus session that was skipped", () => {
    const skipped = advance(idle(), DAY, false);
    expect(skipped.phase).toBe("short");
    expect(skipped.streak).toBe(0);
    expect(skipped.today).toBe(0);
  });

  it("counts the day's sessions, and starts again when the day changes", () => {
    const first = advance(idle(), DAY, true);
    expect(first.today).toBe(1);

    const second = advance({ ...first, phase: "focus" }, DAY, true);
    expect(second.today).toBe(2);

    const tomorrow = advance({ ...second, phase: "focus" }, "2026-09-17", true);
    expect(tomorrow.today).toBe(1);
  });

  it("gives every new phase its full length, stopped", () => {
    const afterFocus = advance(idle(), DAY, true);
    expect(remaining(afterFocus, NOW)).toBe(DURATIONS.short);
    expect(isRunning(afterFocus)).toBe(false);
  });

  it("marks the run of four under the clock", () => {
    expect(dots(idle())).toEqual([false, false, false, false]);
    expect(dots({ ...idle(), streak: 2 })).toEqual([true, true, false, false]);
    // A finished run shows empty again: the next session starts a new one.
    expect(dots({ ...idle(), streak: 4 })).toEqual([false, false, false, false]);
  });
});

describe("what it reads as", () => {
  it("is minutes and seconds, padded", () => {
    expect(formatRemaining(DURATIONS.focus)).toBe("25:00");
    expect(formatRemaining(61_000)).toBe("1:01");
    expect(formatRemaining(0)).toBe("0:00");
    expect(formatRemaining(-5_000)).toBe("0:00");
    expect(formatRemaining(3_600_000)).toBe("1:00:00");
  });

  /** A second that has started is a second still to go, not one already gone. */
  it("rounds a part-second up, so the clock never sits on 0:00 while running", () => {
    expect(formatRemaining(500)).toBe("0:01");
    expect(formatRemaining(60_500)).toBe("1:01");
  });

  it("reports progress through the phase for the ring", () => {
    const started = start(idle(), NOW);
    expect(progress(started, NOW)).toBe(0);
    expect(progress(started, NOW + DURATIONS.focus / 2)).toBeCloseTo(0.5);
    expect(progress(started, NOW + DURATIONS.focus * 2)).toBe(1);
  });
});
