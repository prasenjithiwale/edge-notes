/**
 * Everything about *when* a task is: local calendar arithmetic, the sections the
 * list is grouped into, and the words each one is shown with.
 *
 * A task's fields live in the database now, not in tokens at the end of a line,
 * so this no longer parses storage — with one exception. `parseTaskText` is kept
 * for quick entry: typing
 *
 *     Call the bank !high @2026-09-20 14:00 repeat:weekly
 *
 * into the add field still fills in the details, which is both a real
 * convenience and the muscle memory of everyone who used the old format.
 *
 * Dates are local `YYYY-MM-DD` and times local `HH:MM`, because "the 20th at
 * 2 pm" means that wherever you are. Rust stores them as written and does none
 * of this arithmetic: it has no timezone and no locale to do it in.
 *
 * Pure: every function that needs the current time takes it.
 */
import { PRIORITIES, REPEATS, type Priority, type Repeat, type Task } from "./ipc";

export type { Priority, Repeat };
export { PRIORITIES, REPEATS };

/** The when of a task, as the pickers and the labels pass it around. */
export interface Due {
  /** `YYYY-MM-DD`, local. */
  date: string;
  /** `HH:MM`, 24-hour, local; null for a whole-day task. */
  time: string | null;
}

export function dueOf(task: Task): Due | null {
  return task.dueDate === null ? null : { date: task.dueDate, time: task.dueTime };
}

export function isDone(task: Task): boolean {
  return task.doneAt !== null;
}

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

// ---------------------------------------------------------------------------
// Quick entry
// ---------------------------------------------------------------------------

const PRIORITY_TOKEN = /(^|\s+)!(high|medium|low)$/i;
const DUE_TOKEN = /(^|\s+)@(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):(\d{2}))?$/;
const REPEAT_TOKEN = /(^|\s+)repeat:(daily|weekly|monthly|yearly)$/i;

export interface QuickTask {
  title: string;
  priority: Priority | null;
  due: Due | null;
  repeat: Repeat | null;
}

/**
 * Read the detail tokens off the end of something typed into the add field.
 *
 * Tokens are taken only from the end, so "email @john" or "fix !bug" in the
 * middle of a sentence is never mistaken for one. Anything that does not parse
 * cleanly stays part of the title.
 */
export function parseTaskText(text: string): QuickTask {
  let rest = text.trim();
  let priority: Priority | null = null;
  let due: Due | null = null;
  let repeat: Repeat | null = null;

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

  return { title: rest.replace(/\s+/g, " ").trim(), priority, due, repeat };
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

// ---------------------------------------------------------------------------
// Sections, order and labels
// ---------------------------------------------------------------------------

export type DueSection = "overdue" | "today" | "tomorrow" | "upcoming" | "none" | "done";

/**
 * The order the list shows them in. Done last, and only for what was finished
 * recently: a task list is about what is left, and yesterday's ticks are
 * reassurance, not work.
 */
export const SECTIONS: readonly DueSection[] = [
  "overdue",
  "today",
  "tomorrow",
  "upcoming",
  "none",
  "done",
];

export const SECTION_LABELS: Record<DueSection, string> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  upcoming: "Upcoming",
  none: "Someday",
  done: "Done",
};

/** How long a completed task stays in the Done section. */
export const DONE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A task due earlier today at a set time is overdue once that time has passed. */
export function dueSection(due: Due | null, now: Date): DueSection {
  if (due === null) {
    return "none";
  }
  const today = dateKey(now);
  if (due.date < today) {
    return "overdue";
  }
  if (due.date === addDays(today, 1)) {
    return "tomorrow";
  }
  if (due.date > today) {
    return "upcoming";
  }
  return due.time !== null && due.time < timeKey(now) ? "overdue" : "today";
}

/** Which section a task belongs in, completion included. */
export function taskSection(task: Task, now: Date): DueSection {
  return isDone(task) ? "done" : dueSection(dueOf(task), now);
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/**
 * Order within a section: higher priority first, then sooner, with a whole-day
 * task before the timed tasks of the same day, and oldest first when neither
 * says otherwise — so a list with no details keeps the order it was written in.
 */
export function compareTasks(a: Task, b: Task): number {
  const rank = (task: Task) => (task.priority === null ? 3 : PRIORITY_RANK[task.priority]);
  if (rank(a) !== rank(b)) {
    return rank(a) - rank(b);
  }
  const when = (task: Task) =>
    task.dueDate === null ? "~" : `${task.dueDate} ${task.dueTime ?? ""}`;
  if (when(a) !== when(b)) {
    return when(a) < when(b) ? -1 : 1;
  }
  return a.createdAt - b.createdAt;
}

/** Most recently finished first: the Done section is a history, newest at the top. */
export function compareDone(a: Task, b: Task): number {
  return (b.doneAt ?? 0) - (a.doneAt ?? 0);
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
