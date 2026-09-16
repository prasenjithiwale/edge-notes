import { create } from "zustand";

import {
  advance,
  endNotice,
  hasElapsed,
  idle,
  isRunning,
  pause,
  reset,
  start,
  type Phase,
  type Pomodoro,
} from "../lib/pomodoro";
import { dateKey } from "../lib/taskMeta";
import type { Reminder } from "../lib/tasks";

interface PomodoroStore {
  state: Pomodoro;
  /** What was announced last, so the same end is not announced twice. */
  announced: string | null;

  startTimer: () => void;
  pauseTimer: () => void;
  resetTimer: () => void;
  /** Move on without finishing: a skipped focus session is not counted. */
  skip: () => void;
  /** Called on every tick: ends the phase once its time is up. */
  settle: (now: number) => void;
}

export const usePomodoroStore = create<PomodoroStore>((set, get) => ({
  state: idle(),
  announced: null,

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
   */
  settle: (now) => {
    const { state } = get();
    if (!hasElapsed(state, now)) {
      return;
    }
    set({ state: advance(state, dateKey(new Date(now)), true) });
  },
}));

/**
 * The reminder for a running phase, sent to Rust with the tasks' reminders so a
 * session that ends while the panel is closed still says so. One at a time, with
 * the end time in its id, so re-sending the list never repeats a notification
 * and pausing withdraws it.
 */
export function pomodoroReminder(state: Pomodoro): Reminder[] {
  if (!isRunning(state) || state.endsAt === null) {
    return [];
  }
  const notice = endNotice(state.phase);
  return [
    {
      id: `pomodoro|${state.phase}|${String(state.endsAt)}`,
      at: state.endsAt,
      title: notice.title,
      body: notice.body,
    },
  ];
}

export type { Phase, Pomodoro };
