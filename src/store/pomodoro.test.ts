import { beforeEach, describe, expect, it, vi } from "vitest";

import { DURATIONS, idle, isRunning } from "../lib/pomodoro";
import { pomodoroReminder, usePomodoroStore } from "./pomodoro";

const NOW = new Date(2026, 8, 16, 10, 0).getTime();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  usePomodoroStore.setState({ state: idle(), announced: null });
});

describe("settling a phase that has run out", () => {
  /**
   * The end is noticed, not scheduled: a webview throttled to a tick a minute
   * while the panel sat closed must still come back to the right phase.
   */
  it("moves to the break the moment anything asks, however late that is", () => {
    usePomodoroStore.getState().startTimer();
    expect(isRunning(usePomodoroStore.getState().state)).toBe(true);

    // Nothing ran for the whole session and then some.
    usePomodoroStore.getState().settle(NOW + DURATIONS.focus + 10 * 60_000);

    const { state } = usePomodoroStore.getState();
    expect(state.phase).toBe("short");
    expect(state.streak).toBe(1);
    expect(state.today).toBe(1);
    expect(isRunning(state)).toBe(false);
  });

  it("does nothing while the phase is still going", () => {
    usePomodoroStore.getState().startTimer();
    usePomodoroStore.getState().settle(NOW + 60_000);
    expect(usePomodoroStore.getState().state.phase).toBe("focus");
  });

  it("does nothing at all when the timer is not running", () => {
    usePomodoroStore.getState().settle(NOW + 10 * 60 * 60_000);
    expect(usePomodoroStore.getState().state).toEqual(idle());
  });
});

describe("the reminder Rust is given", () => {
  it("is one, at the moment the running phase ends", () => {
    usePomodoroStore.getState().startTimer();
    const [reminder] = pomodoroReminder(usePomodoroStore.getState().state);

    expect(reminder?.at).toBe(NOW + DURATIONS.focus);
    expect(reminder?.title).toBe("Focus finished");
    expect(reminder?.id).toContain("pomodoro");
  });

  it("is withdrawn when the timer is paused, and re-armed on a new end", () => {
    usePomodoroStore.getState().startTimer();
    const first = pomodoroReminder(usePomodoroStore.getState().state)[0]?.id;

    usePomodoroStore.getState().pauseTimer();
    expect(pomodoroReminder(usePomodoroStore.getState().state)).toEqual([]);

    vi.setSystemTime(NOW + 120_000);
    usePomodoroStore.getState().startTimer();
    // A different end, so Rust treats it as a reminder it has not shown.
    expect(pomodoroReminder(usePomodoroStore.getState().state)[0]?.id).not.toBe(first);
  });

  it("says something different when a break ends", () => {
    usePomodoroStore.getState().skip();
    usePomodoroStore.getState().startTimer();
    expect(pomodoroReminder(usePomodoroStore.getState().state)[0]?.title).toBe("Break over");
  });

  it("is nothing at all before anything has been started", () => {
    expect(pomodoroReminder(idle())).toEqual([]);
  });
});
