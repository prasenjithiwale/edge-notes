/**
 * A task's details — priority, due date and time, repeat — kept as short tokens
 * at the end of its checklist line, so a task is still one plain line of text:
 *
 *     - [ ] Call the bank !high @2026-09-20 14:00 repeat:weekly
 *
 * Tokens are read only from the end of the line, so "email @john" or "fix !bug"
 * in the middle of a sentence is never mistaken for one. They are written back in
 * that fixed order. Dates and times are local, as a person means them.
 *
 * Pure: every function that needs the current time takes it.
 */

export const PRIORITIES = ["high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const REPEATS = ["daily", "weekly", "monthly", "yearly"] as const;
export type Repeat = (typeof REPEATS)[number];

export interface Due {
  /** `YYYY-MM-DD`, local. */
  date: string;
  /** `HH:MM`, 24-hour, local; null for a whole-day task. */
  time: string | null;
}

export interface TaskMeta {
  /** The task text with its tokens removed. */
  title: string;
  priority: Priority | null;
  due: Due | null;
  repeat: Repeat | null;
}

const PRIORITY_TOKEN = /(^|\s+)!(high|medium|low)$/i;
const DUE_TOKEN = /(^|\s+)@(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):(\d{2}))?$/;
const REPEAT_TOKEN = /(^|\s+)repeat:(daily|weekly|monthly|yearly)$/i;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** A real calendar date: `2026-02-30` is not one. */
function isValidDate(key: string): boolean {
  const [year = 0, month = 0, day = 0] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
  );
}

export function parseTaskText(text: string): TaskMeta {
  let rest = text.trim();
  let priority: Priority | null = null;
  let due: Due | null = null;
  let repeat: Repeat | null = null;

  // Peel tokens off the end, in any order, each kind at most once. Anything that
  // does not parse cleanly stays part of the title.
  for (;;) {
    const p: RegExpExecArray | null = priority === null ? PRIORITY_TOKEN.exec(rest) : null;
    if (p) {
      priority = (p[2] ?? "").toLowerCase() as Priority;
      rest = rest.slice(0, p.index).trimEnd();
      continue;
    }
    const d: RegExpExecArray | null = due === null ? DUE_TOKEN.exec(rest) : null;
    if (d) {
      const date: string = d[2] ?? "";
      const hours: string | undefined = d[3];
      const minutes: string | undefined = d[4];
      const time: string | null =
        hours === undefined || minutes === undefined ? null : `${pad(Number(hours))}:${minutes}`;
      const timeValid = time === null || (Number(hours) < 24 && Number(minutes) < 60);
      if (isValidDate(date) && timeValid) {
        due = { date, time };
        rest = rest.slice(0, d.index).trimEnd();
        continue;
      }
    }
    const r: RegExpExecArray | null = repeat === null ? REPEAT_TOKEN.exec(rest) : null;
    if (r) {
      repeat = (r[2] ?? "").toLowerCase() as Repeat;
      rest = rest.slice(0, r.index).trimEnd();
      continue;
    }
    break;
  }

  return { title: rest, priority, due, repeat };
}

/** The task line's text from its parts, tokens in their fixed order. */
export function formatTaskText(meta: TaskMeta): string {
  return [
    meta.title.trim(),
    meta.priority === null ? "" : `!${meta.priority}`,
    meta.due === null ? "" : `@${meta.due.date}${meta.due.time === null ? "" : ` ${meta.due.time}`}`,
    meta.repeat === null ? "" : `repeat:${meta.repeat}`,
  ]
    .filter((part) => part !== "")
    .join(" ");
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Local `YYYY-MM-DD` for a moment. */
export function dateKey(moment: Date): string {
  return `${String(moment.getFullYear())}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}`;
}

/** Local `HH:MM` for a moment. */
export function timeKey(moment: Date): string {
  return `${pad(moment.getHours())}:${pad(moment.getMinutes())}`;
}

function fromKey(key: string, time: string | null = null): Date {
  const [year = 0, month = 1, day = 1] = key.split("-").map(Number);
  const [hours = 0, minutes = 0] = (time ?? "00:00").split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}

export function addDays(key: string, days: number): string {
  const date = fromKey(key);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

/** Calendar months, clamped: 31 January plus a month is the end of February. */
export function addMonths(key: string, months: number): string {
  const [year = 0, month = 1, day = 1] = key.split("-").map(Number);
  const target = new Date(year, month - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return dateKey(target);
}

function step(key: string, repeat: Repeat): string {
  switch (repeat) {
    case "daily":
      return addDays(key, 1);
    case "weekly":
      return addDays(key, 7);
    case "monthly":
      return addMonths(key, 1);
    case "yearly":
      return addMonths(key, 12);
  }
}

/**
 * Where a repeating task's date goes when it is ticked: one step on from its due
 * date, and further while that is still in the past, so a daily task left for a
 * week comes back today rather than a week ago. With no date it counts from
 * today.
 */
export function nextOccurrence(due: Due | null, repeat: Repeat, now: Date): Due {
  const today = dateKey(now);
  let next = step(due?.date ?? today, repeat);
  while (next < today) {
    next = step(next, repeat);
  }
  return { date: next, time: due?.time ?? null };
}

/**
 * The line's new text when its box is ticked: a repeating task moves to its next
 * date and stays open; anything else is simply ticked. Null means "just tick it".
 */
export function repeatOnTick(text: string, now: Date): string | null {
  const meta = parseTaskText(text);
  if (meta.repeat === null) {
    return null;
  }
  return formatTaskText({ ...meta, due: nextOccurrence(meta.due, meta.repeat, now) });
}

// ---------------------------------------------------------------------------
// Sections, order and labels for the Tasks tab
// ---------------------------------------------------------------------------

export type DueSection = "overdue" | "today" | "upcoming" | "none";

export const SECTION_LABELS: Record<DueSection, string> = {
  overdue: "Overdue",
  today: "Today",
  upcoming: "Upcoming",
  none: "No date",
};

/** A task due earlier today at a set time is overdue once that time has passed. */
export function dueSection(due: Due | null, now: Date): DueSection {
  if (due === null) {
    return "none";
  }
  const today = dateKey(now);
  if (due.date < today) {
    return "overdue";
  }
  if (due.date > today) {
    return "upcoming";
  }
  return due.time !== null && due.time < timeKey(now) ? "overdue" : "today";
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/**
 * Order within a section: higher priority first, then sooner, with a whole-day
 * task before the timed tasks of the same day. Stable otherwise, so tasks without
 * details keep the order they are written in.
 */
export function compareTasks(a: TaskMeta, b: TaskMeta): number {
  const rank = (meta: TaskMeta) => (meta.priority === null ? 3 : PRIORITY_RANK[meta.priority]);
  if (rank(a) !== rank(b)) {
    return rank(a) - rank(b);
  }
  const when = (meta: TaskMeta) =>
    meta.due === null ? "~" : `${meta.due.date} ${meta.due.time ?? ""}`;
  return when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : 0;
}

/** When a reminder fires: the due time, or 09:00 for a whole-day task. */
export const WHOLE_DAY_REMINDER = "09:00";

export function reminderAt(due: Due): number {
  return fromKey(due.date, due.time ?? WHOLE_DAY_REMINDER).getTime();
}

export function priorityLabel(priority: Priority): string {
  return priority.slice(0, 1).toUpperCase() + priority.slice(1);
}

export function repeatLabel(repeat: Repeat): string {
  return repeat.slice(0, 1).toUpperCase() + repeat.slice(1);
}

/**
 * "Today", "Tomorrow, 2:00 pm", "Sat", "20 Sep", "20 Sep 2027". Relative words
 * near today, a weekday within the coming week, a date beyond. Times and month
 * names follow the system locale unless one is given (tests pass one).
 */
export function dueLabel(due: Due, now: Date, locale?: string): string {
  const today = dateKey(now);
  const moment = fromKey(due.date, due.time);
  let day: string;
  if (due.date === today) {
    day = "Today";
  } else if (due.date === addDays(today, 1)) {
    day = "Tomorrow";
  } else if (due.date === addDays(today, -1)) {
    day = "Yesterday";
  } else if (due.date > today && due.date < addDays(today, 7)) {
    day = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(moment);
  } else {
    day = new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      ...(due.date.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
    }).format(moment);
  }
  if (due.time === null) {
    return day;
  }
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(
    moment,
  );
  return `${day}, ${time}`;
}
