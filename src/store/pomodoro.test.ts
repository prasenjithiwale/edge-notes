import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DURATIONS, idle, isRunning, MINUTE } from "../lib/pomodoro";
import type { Settings } from "../lib/ipc";

// The store writes the day's tally through the settings store, which talks to
// Rust. Nothing here is checking that write, but it must not reach a webview
// that is not there.
const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invoke(command, args),
}));

const { pomodoroReminder, usePomodoroStore } = await import("./pomodoro");
const { useSettingsStore } = await import("./settings");

const NOW = new Date(2026, 8, 16, 10, 0).getTime();
const TODAY = "2026-09-16";

function settings(over: Partial<Settings> = {}): Settings {
  return { ...useSettingsStore.getState().settings, ...over };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  invoke.mockReset();
  invoke.mockResolvedValue({ ok: settings() });
  usePomodoroStore.setState({
    state: idle(),
    autoStart: false,
    taskId: null,
    hydrated: false,
  });
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
    usePomodoroStore.getState().settle(NOW + DEFAULT_DURATIONS.focus + 10 * 60_000);

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

    expect(reminder?.at).toBe(NOW + DEFAULT_DURATIONS.focus);
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

  it("names the task the session is for, when there is one", () => {
    usePomodoroStore.getState().startTimer();
    const [reminder] = pomodoroReminder(usePomodoroStore.getState().state, "Rewrite the intro");
    expect(reminder?.body).toContain("Rewrite the intro");
  });
});

describe("taking the stored settings", () => {
  it("runs to the lengths that are stored", () => {
    usePomodoroStore
      .getState()
      .hydrate(settings({ "focus.focusMinutes": 50, "focus.longBreakEvery": 2 }));

    usePomodoroStore.getState().startTimer();
    const { state } = usePomodoroStore.getState();
    expect(state.endsAt).toBe(NOW + 50 * MINUTE);
    expect(state.durations.longEvery).toBe(2);
  });

  it("reads the day's tally back, and only if it is today's", () => {
    usePomodoroStore
      .getState()
      .hydrate(settings({ "focus.day": TODAY, "focus.today": 3, "focus.streak": 3 }));
    expect(usePomodoroStore.getState().state.today).toBe(3);

    usePomodoroStore.setState({ hydrated: false });
    usePomodoroStore
      .getState()
      .hydrate(settings({ "focus.day": "2026-09-15", "focus.today": 3, "focus.streak": 3 }));
    expect(usePomodoroStore.getState().state.today).toBe(0);
    // The run to the long break is earned, not scheduled, so it survives.
    expect(usePomodoroStore.getState().state.streak).toBe(3);
  });

  /**
   * Settings changing again while the app runs must not reach back and replace
   * what has happened since: the stored copy is written from here.
   */
  it("never re-reads the tally once it has been read", () => {
    usePomodoroStore.getState().hydrate(settings({ "focus.day": TODAY, "focus.today": 1 }));
    usePomodoroStore.getState().startTimer();
    usePomodoroStore.getState().settle(NOW + DEFAULT_DURATIONS.focus);
    expect(usePomodoroStore.getState().state.today).toBe(2);

    usePomodoroStore.getState().hydrate(settings({ "focus.day": TODAY, "focus.today": 1 }));
    expect(usePomodoroStore.getState().state.today).toBe(2);
  });

  it("writes the tally back when a session finishes", () => {
    usePomodoroStore.getState().hydrate(settings());
    usePomodoroStore.getState().startTimer();
    usePomodoroStore.getState().settle(NOW + DEFAULT_DURATIONS.focus);

    const patch = invoke.mock.calls.find(([name]) => name === "settings_update")?.[1] as
      | { patch: Record<string, unknown> }
      | undefined;
    expect(patch?.patch["focus.today"]).toBe(1);
    expect(patch?.patch["focus.day"]).toBe(TODAY);
  });
});

describe("starting the next phase by itself", () => {
  it("does not, unless it has been asked to", () => {
    usePomodoroStore.getState().hydrate(settings());
    usePomodoroStore.getState().startTimer();
    usePomodoroStore.getState().settle(NOW + DEFAULT_DURATIONS.focus);
    expect(isRunning(usePomodoroStore.getState().state)).toBe(false);
  });

  /**
   * From the moment it was noticed, never from the moment the phase ended:
   * coming back twenty minutes late must not hand you a break already over.
   */
  it("starts the break from now, not from when the session ran out", () => {
    usePomodoroStore.getState().hydrate(settings({ "focus.autoStart": true }));
    usePomodoroStore.getState().startTimer();

    const late = NOW + DEFAULT_DURATIONS.focus + 20 * MINUTE;
    usePomodoroStore.getState().settle(late);

    const { state } = usePomodoroStore.getState();
    expect(state.phase).toBe("short");
    expect(state.endsAt).toBe(late + DEFAULT_DURATIONS.short);
  });
});
