import { create } from "zustand";

import type { Settings } from "../lib/ipc";
import {
  advance,
  DEFAULT_DURATIONS,
  endNotice,
  hasElapsed,
  idle,
  isRunning,
  MINUTE,
  pause,
  reset,
  sameDurations,
  start,
  withDurations,
  type Durations,
  type Phase,
  type Pomodoro,
} from "../lib/pomodoro";
import { dateKey } from "../lib/taskMeta";
import type { Reminder } from "../lib/tasks";
import { useSettingsStore } from "./settings";

/** The stored minutes, as the milliseconds the timer works in. */
export function durationsFrom(settings: Settings): Durations {
  return {
    focus: settings["focus.focusMinutes"] * MINUTE,
    short: settings["focus.breakMinutes"] * MINUTE,
    long: settings["focus.longBreakMinutes"] * MINUTE,
    longEvery: settings["focus.longBreakEvery"],
  };
}

interface PomodoroStore {
  state: Pomodoro;
  /** Start the next phase by itself when one ends (`focus.autoStart`). */
  autoStart: boolean;
  /** The task this session is for, or null. */
  taskId: string | null;
  /** The day's tally has been read back from storage; it is only read once. */
  hydrated: boolean;

  /**
   * Take the lengths, the auto-start switch and — the first time only — the
   * tally and the task from the stored settings.
   */
  hydrate: (settings: Settings) => void;

  startTimer: () => void;
  pauseTimer: () => void;
  resetTimer: () => void;
  /** Move on without finishing: a skipped focus session is not counted. */
  skip: () => void;
  /** Called on every tick: ends the phase once its time is up. */
  settle: (now: number) => void;
  setTask: (id: string | null) => void;
}

/**
 * The day's tally is state, not a preference, but the settings table is the
 * app's key/value store and a counter does not deserve a table of its own. The
 * write goes through the settings store so there is one path to Rust.
 */
function persistTally(state: Pomodoro): void {
  void useSettingsStore.getState().patch({
    "focus.day": state.day,
    "focus.today": state.today,
    "focus.streak": state.streak,
  });
}

export const usePomodoroStore = create<PomodoroStore>((set, get) => ({
  state: idle(),
  autoStart: false,
  taskId: null,
  hydrated: false,

  hydrate: (settings) => {
    const durations = durationsFrom(settings);
    const { hydrated, state } = get();
    if (hydrated) {
      // Settings changed while the app was running: the lengths and the switch
      // follow, the tally does not — what is on screen is newer than what is
      // stored, and the stored copy is written from here in the first place.
      if (!sameDurations(state.durations, durations) || get().autoStart !== settings["focus.autoStart"]) {
        set({ state: withDurations(state, durations), autoStart: settings["focus.autoStart"] });
      }
      return;
    }

    const day = settings["focus.day"];
    const today = dateKey(new Date());
    set({
      hydrated: true,
      autoStart: settings["focus.autoStart"],
      taskId: settings["focus.taskId"] === "" ? null : settings["focus.taskId"],
      state: {
        ...idle("focus", durations),
        // A tally from an earlier day is not today's, and a run of four that
        // was interrupted by a restart is not worth carrying either way: the
        // streak is kept because the long break is earned, not scheduled.
        day,
        today: day === today ? settings["focus.today"] : 0,
        streak: settings["focus.streak"],
      },
    });
  },

  startTimer: () => {
    set((store) => ({ state: start(store.state, Date.now()) }));
  },

  pauseTimer: () => {
    set((store) => ({ state: pause(store.state, Date.now()) }));
  },

  resetTimer: () => {
    set((store) => ({ state: reset(store.state) }));
  },

  skip: () => {
    const now = Date.now();
    set((store) => ({ state: advance(store.state, dateKey(new Date(now)), false) }));
  },

  /**
   * The end of a phase is noticed rather than scheduled.
   *
   * A timer that fired the change itself would be wrong every time the webview
   * was throttled while the panel sat collapsed behind another app. The state
   * knows when it ends; anything that asks what time it is can settle it, and
   * the answer is the same whether that happened on the second or a minute late.
   *
   * With auto-start on, the next phase begins *now* rather than at the moment
   * the last one ended: noticing twenty minutes late must not hand you a break
   * that is already over.
   */
  settle: (now) => {
    const { state, autoStart } = get();
    if (!hasElapsed(state, now)) {
      return;
    }
    const next = advance(state, dateKey(new Date(now)), true);
    set({ state: autoStart ? start(next, now) : next });
    persistTally(next);
  },

  setTask: (id) => {
    if (get().taskId === id) {
      return;
    }
    set({ taskId: id });
    void useSettingsStore.getState().patch({ "focus.taskId": id ?? "" });
  },
}));

/**
 * The reminder for a running phase, sent to Rust with the tasks' reminders so a
 * session that ends while the panel is closed still says so. One at a time, with
 * the end time in its id, so re-sending the list never repeats a notification
 * and pausing withdraws it.
 */
export function pomodoroReminder(state: Pomodoro, task?: string | null): Reminder[] {
  if (!isRunning(state) || state.endsAt === null) {
    return [];
  }
  const notice = endNotice(state.phase, task);
  return [
    {
      id: `pomodoro|${state.phase}|${String(state.endsAt)}`,
      at: state.endsAt,
      title: notice.title,
      body: notice.body,
    },
  ];
}

export { DEFAULT_DURATIONS };
export type { Phase, Pomodoro };
