/**
 * The Focus tab's rules: a pomodoro timer, as arithmetic on timestamps.
 *
 * The timer is kept as the moment it *ends*, never as a number counted down.
 * A widget spends most of its life in a collapsed panel behind another app,
 * where a browser is free to throttle timers to once a minute or stop them
 * altogether; anything that decremented a counter on a tick would lose minutes
 * and never know. Reading `endsAt - now` is right however long nothing ran.
 *
 * Pure, like the rest of `lib/`: every function that needs the time takes it.
 */

export type Phase = "focus" | "short" | "long";

/** The classic lengths. Settable later; this is the whole of "basic" for now. */
export const DURATIONS: Record<Phase, number> = {
  focus: 25 * 60_000,
  short: 5 * 60_000,
  long: 15 * 60_000,
};

/** How many focus sessions earn the long break. */
export const LONG_BREAK_EVERY = 4;

export const PHASE_LABELS: Record<Phase, string> = {
  focus: "Focus",
  short: "Short break",
  long: "Long break",
};

export interface Pomodoro {
  phase: Phase;
  /** When the current phase ends, or null while it is paused or not started. */
  endsAt: number | null;
  /** What is left of the phase while it is paused. */
  restMs: number;
  /** Focus sessions finished since the last long break. */
  streak: number;
  /** Focus sessions finished on `day`, which is a local `YYYY-MM-DD`. */
  day: string;
  today: number;
}

export function idle(phase: Phase = "focus"): Pomodoro {
  return {
    phase,
    endsAt: null,
    restMs: DURATIONS[phase],
    streak: 0,
    day: "",
    today: 0,
  };
}

export function isRunning(state: Pomodoro): boolean {
  return state.endsAt !== null;
}

/** Milliseconds left, never below zero. */
export function remaining(state: Pomodoro, now: number): number {
  if (state.endsAt === null) {
    return Math.max(0, state.restMs);
  }
  return Math.max(0, state.endsAt - now);
}

/** How much of the phase has gone, 0 to 1, for the ring. */
export function progress(state: Pomodoro, now: number): number {
  const total = DURATIONS[state.phase];
  if (total <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, 1 - remaining(state, now) / total));
}

/** "25:00", and "1:00:00" if a phase is ever set longer than an hour. */
export function formatRemaining(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${String(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${String(minutes)}:${pad(seconds)}`;
}

export function start(state: Pomodoro, now: number): Pomodoro {
  if (isRunning(state)) {
    return state;
  }
  // A phase that has run out starts again from the top rather than ending at once.
  const rest = state.restMs > 0 ? state.restMs : DURATIONS[state.phase];
  return { ...state, endsAt: now + rest, restMs: rest };
}

export function pause(state: Pomodoro, now: number): Pomodoro {
  if (!isRunning(state)) {
    return state;
  }
  return { ...state, endsAt: null, restMs: remaining(state, now) };
}

/** Back to the start of this phase, stopped. */
export function reset(state: Pomodoro): Pomodoro {
  return { ...state, endsAt: null, restMs: DURATIONS[state.phase] };
}

/**
 * The phase after this one. A focus session earns a break — every fourth one the
 * long break — and a break is followed by focus.
 *
 * `counted` says whether the focus session that just ended should be added up:
 * finishing one counts, skipping past it does not.
 */
export function advance(state: Pomodoro, today: string, counted: boolean): Pomodoro {
  if (state.phase !== "focus") {
    return { ...idle("focus"), streak: state.streak, day: state.day, today: state.today };
  }

  const streak = counted ? state.streak + 1 : state.streak;
  const next: Phase = counted && streak % LONG_BREAK_EVERY === 0 ? "long" : "short";
  // The day's tally resets by itself when the day does, so nothing has to run
  // at midnight.
  const sameDay = state.day === today;
  return {
    ...idle(next),
    streak,
    day: counted ? today : state.day,
    today: counted ? (sameDay ? state.today : 0) + 1 : sameDay ? state.today : 0,
  };
}

/** Whether a running phase has reached its end. */
export function hasElapsed(state: Pomodoro, now: number): boolean {
  return state.endsAt !== null && now >= state.endsAt;
}

/** The dots under the clock: how far through the run of four this is. */
export function dots(state: Pomodoro): boolean[] {
  const done = state.streak % LONG_BREAK_EVERY;
  return Array.from({ length: LONG_BREAK_EVERY }, (_, index) => index < done);
}

/**
 * What to say when a phase ends. Rust shows it through the same one-shot
 * reminder thread the tasks use, so a session that finishes while the panel is
 * closed still says so.
 */
export function endNotice(phase: Phase): { title: string; body: string } {
  if (phase === "focus") {
    return { title: "Focus finished", body: "Time for a break." };
  }
  return { title: "Break over", body: "Back to it." };
}
