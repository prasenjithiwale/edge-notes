import { describe, expect, it } from "vitest";

import {
  advance,
  DEFAULT_DURATIONS,
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
  endsLabel,
  MINUTE,
  tallyLabel,
  timeline,
  withDurations,
  type Durations,
} from "./pomodoro";

const NOW = 1_800_000_000_000;
const DAY = "2026-09-16";

describe("running the clock", () => {
  it("starts from a full phase and counts down against the wall clock", () => {
    const started = start(idle(), NOW);
    expect(isRunning(started)).toBe(true);
    expect(remaining(started, NOW)).toBe(DEFAULT_DURATIONS.focus);
    expect(remaining(started, NOW + 60_000)).toBe(DEFAULT_DURATIONS.focus - 60_000);
  });

  /**
   * The point of keeping the end rather than a counter: nothing has to have been
   * running for the answer to be right.
   */
  it("is right after a long gap with nothing running", () => {
    const started = start(idle(), NOW);
    expect(remaining(started, NOW + DEFAULT_DURATIONS.focus + 600_000)).toBe(0);
    expect(hasElapsed(started, NOW + DEFAULT_DURATIONS.focus)).toBe(true);
  });

  it("keeps what is left when paused, and picks it up again", () => {
    const paused = pause(start(idle(), NOW), NOW + 60_000);
    expect(isRunning(paused)).toBe(false);
    expect(remaining(paused, NOW + 300_000)).toBe(DEFAULT_DURATIONS.focus - 60_000);

    const resumed = start(paused, NOW + 300_000);
    expect(remaining(resumed, NOW + 300_000)).toBe(DEFAULT_DURATIONS.focus - 60_000);
    expect(remaining(resumed, NOW + 360_000)).toBe(DEFAULT_DURATIONS.focus - 120_000);
  });

  it("does nothing when told to start something already running", () => {
    const started = start(idle(), NOW);
    expect(start(started, NOW + 5_000)).toBe(started);
  });

  it("starts a phase that has run out from the top rather than at zero", () => {
    const spent = { ...idle(), restMs: 0 };
    expect(remaining(start(spent, NOW), NOW)).toBe(DEFAULT_DURATIONS.focus);
  });

  it("resets to the whole phase, stopped", () => {
    const back = reset(pause(start(idle(), NOW), NOW + 60_000));
    expect(isRunning(back)).toBe(false);
    expect(remaining(back, NOW)).toBe(DEFAULT_DURATIONS.focus);
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
    expect(remaining(afterFocus, NOW)).toBe(DEFAULT_DURATIONS.short);
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
    expect(formatRemaining(DEFAULT_DURATIONS.focus)).toBe("25:00");
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
    expect(progress(started, NOW + DEFAULT_DURATIONS.focus / 2)).toBeCloseTo(0.5);
    expect(progress(started, NOW + DEFAULT_DURATIONS.focus * 2)).toBe(1);
  });
});

/** Anyone may set their own lengths now; the rules must hold for any of them. */
describe("lengths that are not the classic ones", () => {
  const short: Durations = { focus: 10 * MINUTE, short: 2 * MINUTE, long: 20 * MINUTE, longEvery: 2 };

  it("counts down the length it was given", () => {
    const started = start(idle("focus", short), NOW);
    expect(remaining(started, NOW)).toBe(10 * MINUTE);
    expect(progress(started, NOW + 5 * MINUTE)).toBeCloseTo(0.5);
  });

  it("earns the long break after the run it was told to", () => {
    let state = advance(idle("focus", short), DAY, true);
    expect(state.phase).toBe("short");
    state = advance({ ...state, phase: "focus" }, DAY, true);
    expect(state.phase).toBe("long");
    expect(dots(idle("focus", short))).toHaveLength(2);
  });

  it("carries the lengths into every phase that follows", () => {
    const afterFocus = advance(idle("focus", short), DAY, true);
    expect(afterFocus.durations).toEqual(short);
    expect(remaining(afterFocus, NOW)).toBe(2 * MINUTE);
  });
});

describe("adopting lengths changed in Settings", () => {
  const longer: Durations = { ...DEFAULT_DURATIONS, focus: 50 * MINUTE };

  it("gives a stopped phase the new length whole", () => {
    const changed = withDurations(idle(), longer);
    expect(remaining(changed, NOW)).toBe(50 * MINUTE);
  });

  /** The one thing a timer must never do is move the finish line under you. */
  it("leaves a running phase ending exactly where it was", () => {
    const running = start(idle(), NOW);
    const changed = withDurations(running, longer);
    expect(changed.endsAt).toBe(running.endsAt);
    expect(remaining(changed, NOW)).toBe(DEFAULT_DURATIONS.focus);
    // And the next phase runs to the new length.
    expect(remaining(reset({ ...changed, endsAt: null }), NOW)).toBe(50 * MINUTE);
  });

  it("is the same object when nothing changed", () => {
    const state = idle();
    expect(withDurations(state, { ...DEFAULT_DURATIONS })).toBe(state);
  });
});

describe("the lines under the clock", () => {
  it("says how long the phase is before anything has started", () => {
    expect(endsLabel(idle())).toBe("25 min");
  });

  it("says when a running phase will be over", () => {
    const started = start(idle(), NOW);
    // The label is the wall clock, not an arithmetic problem to do in your head.
    expect(endsLabel(started, "en-GB")).toBe(
      `Ends ${new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit" }).format(
        new Date(NOW + DEFAULT_DURATIONS.focus),
      )}`,
    );
  });

  it("counts the day's sessions in words, and only today's", () => {
    expect(tallyLabel(idle(), DAY)).toBe("Nothing finished yet today");
    expect(tallyLabel({ ...idle(), day: DAY, today: 1 }, DAY)).toBe("1 session finished today");
    expect(tallyLabel({ ...idle(), day: DAY, today: 3 }, DAY)).toBe("3 sessions finished today");
    expect(tallyLabel({ ...idle(), day: DAY, today: 3 }, "2026-09-17")).toBe(
      "Nothing finished yet today",
    );
  });
});

describe("the day's timeline", () => {
  it("logs a finished session where it sat, and not a skipped one", () => {
    const running = start(idle(), NOW);
    const done = advance(running, DAY, true);
    expect(done.log).toEqual([[NOW, NOW + DEFAULT_DURATIONS.focus]]);

    expect(advance(running, DAY, false).log).toEqual([]);
    // A break ending keeps the log, and a new day starts a fresh one.
    const back = advance(done, DAY, true);
    expect(back.log).toEqual(done.log);
    expect(advance(start(back, NOW), "2026-09-17", true).log).toHaveLength(1);
  });

  it("lays sessions on a working day and stretches to fit one outside it", () => {
    const at = (hour: number) => new Date(2026, 8, 16, hour).getTime();
    const day = timeline([[at(9), at(10)]], at(12));
    expect([day.from, day.to]).toEqual([8, 20]);
    expect(day.blocks[0]?.left).toBeCloseTo(1 / 12);
    expect(day.blocks[0]?.width).toBeCloseTo(1 / 12);
    expect(day.now).toBeCloseTo(4 / 12);

    const late = timeline([[at(6), at(7)]], at(22) + 30 * MINUTE);
    expect([late.from, late.to]).toEqual([6, 23]);
  });
});
