/**
 * The Focus tab's rules: a pomodoro timer, as arithmetic on timestamps.
 *
 * The timer is kept as the moment it *ends*, never as a number counted down.
 * A widget spends most of its life in a collapsed panel behind another app,
 * where a browser is free to throttle timers to once a minute or stop them
 * altogether; anything that decremented a counter on a tick would lose minutes
 * and never know. Reading `endsAt - now` is right however long nothing ran.
 *
 * The phase lengths travel inside the state rather than sitting in a module
 * constant, because they are settings now: every function that needs one already
 * has the state in its hand, and a timer running to a length that is no longer
 * stored is a legitimate thing to be in the middle of.
 *
 * Pure, like the rest of `lib/`: every function that needs the time takes it.
 */

export type Phase = "focus" | "short" | "long";

/** The phase lengths, in milliseconds, and the run that earns the long break. */
export interface Durations {
  focus: number;
  short: number;
  long: number;
  /** How many focus sessions earn the long break. */
  longEvery: number;
}

export const MINUTE = 60_000;

/** The classic lengths, and what `Settings::default()` in Rust agrees to. */
export const DEFAULT_DURATIONS: Durations = {
  focus: 25 * MINUTE,
  short: 5 * MINUTE,
  long: 15 * MINUTE,
  longEvery: 4,
};

/** What a phase may be set to, in minutes; mirrored by `FOCUS_MINUTES` in Rust. */
export const MINUTES_RANGE = { min: 1, max: 120 } as const;

/** Mirrored by `LONG_BREAK_EVERY` in Rust. */
export const LONG_EVERY_RANGE = { min: 2, max: 8 } as const;

export const PHASE_LABELS: Record<Phase, string> = {
  focus: "Focus",
  short: "Short break",
  long: "Long break",
};

/** What the phase is *for*, under the clock. */
export const PHASE_HINTS: Record<Phase, string> = {
  focus: "One thing, until the time is up.",
  short: "Look away from the screen.",
  long: "Leave the desk for this one.",
};

/** A finished focus session, `[start, end]` in epoch milliseconds. */
export type Session = [number, number];

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
  /** The focus sessions finished on `day`, as `[start, end]` epoch ms. */
  log: Session[];
  /** The lengths this timer is running to. */
  durations: Durations;
}

export function idle(phase: Phase = "focus", durations: Durations = DEFAULT_DURATIONS): Pomodoro {
  return {
    phase,
    endsAt: null,
    restMs: durations[phase],
    streak: 0,
    day: "",
    today: 0,
    log: [],
    durations,
  };
}

export function isRunning(state: Pomodoro): boolean {
  return state.endsAt !== null;
}

/** How long the current phase is, in full. */
export function phaseLength(state: Pomodoro): number {
  return state.durations[state.phase];
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
  const total = phaseLength(state);
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

/**
 * The line under the clock: when this phase will be over, or how long it is
 * before anything has started.
 *
 * Showing the end time is the difference between "twenty-five minutes" and
 * "quarter past": one has to be added up, and the other is a glance at the same
 * clock every meeting in the day is already in.
 */
export function endsLabel(state: Pomodoro, locale?: string): string {
  if (state.endsAt === null) {
    const minutes = Math.round(remaining(state, 0) / MINUTE);
    return minutes <= 0 ? "Ready" : `${String(minutes)} min`;
  }
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(
    new Date(state.endsAt),
  );
  return `Ends ${time}`;
}

export function start(state: Pomodoro, now: number): Pomodoro {
  if (isRunning(state)) {
    return state;
  }
  // A phase that has run out starts again from the top rather than ending at once.
  const rest = state.restMs > 0 ? state.restMs : phaseLength(state);
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
  return { ...state, endsAt: null, restMs: phaseLength(state) };
}

export function sameDurations(a: Durations, b: Durations): boolean {
  return (
    a.focus === b.focus && a.short === b.short && a.long === b.long && a.longEvery === b.longEvery
  );
}

/**
 * Adopt lengths changed in Settings.
 *
 * A running phase keeps the end it was started with and the change applies from
 * the next one: moving the finish line under someone who is mid-session is the
 * one thing a timer must never do. A stopped phase takes the new length whole,
 * which is the only answer that does not need explaining.
 */
export function withDurations(state: Pomodoro, durations: Durations): Pomodoro {
  if (sameDurations(state.durations, durations)) {
    return state;
  }
  return {
    ...state,
    durations,
    restMs: isRunning(state) ? state.restMs : durations[state.phase],
  };
}

/**
 * The phase after this one. A focus session earns a break — every `longEvery`-th
 * one the long break — and a break is followed by focus.
 *
 * `counted` says whether the focus session that just ended should be added up:
 * finishing one counts, skipping past it does not.
 */
export function advance(state: Pomodoro, today: string, counted: boolean): Pomodoro {
  if (state.phase !== "focus") {
    return {
      ...idle("focus", state.durations),
      streak: state.streak,
      day: state.day,
      today: state.today,
      log: state.log,
    };
  }

  const streak = counted ? state.streak + 1 : state.streak;
  const every = Math.max(1, state.durations.longEvery);
  const next: Phase = counted && streak % every === 0 ? "long" : "short";
  // The day's tally resets by itself when the day does, so nothing has to run
  // at midnight.
  const sameDay = state.day === today;
  const log = sameDay ? state.log : [];
  // Where the session sat on the clock: it ended when it was due to, and it was
  // the focus length long. A pause in the middle shifts the start, not the time
  // spent, which is what the timeline is about.
  const session: Session | null =
    counted && state.endsAt !== null ? [state.endsAt - state.durations.focus, state.endsAt] : null;
  return {
    ...idle(next, state.durations),
    streak,
    day: counted ? today : state.day,
    today: counted ? (sameDay ? state.today : 0) + 1 : sameDay ? state.today : 0,
    log: session === null ? log : [...log, session],
  };
}

/** Whether a running phase has reached its end. */
export function hasElapsed(state: Pomodoro, now: number): boolean {
  return state.endsAt !== null && now >= state.endsAt;
}

/** The dots under the clock: how far through the run to the long break this is. */
export function dots(state: Pomodoro): boolean[] {
  const every = Math.max(1, state.durations.longEvery);
  const done = state.streak % every;
  return Array.from({ length: every }, (_, index) => index < done);
}

/** The tally, as the sentence under the controls. */
export function tallyLabel(state: Pomodoro, today: string): string {
  const count = state.day === today ? state.today : 0;
  if (count === 0) {
    return "Nothing finished yet today";
  }
  return count === 1 ? "1 session finished today" : `${String(count)} sessions finished today`;
}

/**
 * What to say when a phase ends. Rust shows it through the same one-shot
 * reminder thread the tasks use, so a session that finishes while the panel is
 * closed still says so. A session with a task attached says which one.
 */
export function endNotice(phase: Phase, task?: string | null): { title: string; body: string } {
  if (phase === "focus") {
    const name = task?.trim();
    return {
      title: "Focus finished",
      body: name ? `${name} — time for a break.` : "Time for a break.",
    };
  }
  return { title: "Break over", body: "Back to it." };
}

/**
 * The rhythms offered as one press each: focus and break, in minutes. The
 * stepper is for anything else.
 */
export const PRESETS: readonly (readonly [focus: number, rest: number])[] = [
  [25, 5],
  [50, 10],
  [90, 20],
];

/** Where the day's timeline starts and ends, in hours: a working day, stretched when a session falls outside it. */
export const TIMELINE_HOURS = { start: 8, end: 20 } as const;

/** One session on the timeline, as fractions of its width. */
export interface TimelineBlock {
  left: number;
  width: number;
}

export interface Timeline {
  /** The first and last hour shown. */
  from: number;
  to: number;
  blocks: TimelineBlock[];
  /** Where now is; the span always includes it. */
  now: number;
}

/**
 * The day's sessions laid on a bar from `from` to `to` o'clock. The bar shows a
 * working day and widens to whole hours when a session or now falls outside it,
 * so nothing is ever drawn off the end.
 */
export function timeline(log: readonly Session[], now: number): Timeline {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const base = midnight.getTime();
  const hours = (at: number) => (at - base) / 3_600_000;

  let from: number = TIMELINE_HOURS.start;
  let to: number = TIMELINE_HOURS.end;
  for (const at of [now, ...log.flat()]) {
    const hour = Math.min(24, Math.max(0, hours(at)));
    from = Math.min(from, Math.floor(hour));
    to = Math.max(to, Math.ceil(hour));
  }

  const span = to - from;
  const place = (at: number) => Math.min(1, Math.max(0, (hours(at) - from) / span));
  return {
    from,
    to,
    blocks: log.map(([start, end]) => {
      const left = place(start);
      return { left, width: Math.max(0, place(end) - left) };
    }),
    now: place(now),
  };
}
