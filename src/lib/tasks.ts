/**
 * The Tasks tab's model: how a flat list of stored tasks becomes the grouped,
 * ordered list on screen, and what Rust is told to remind you about.
 *
 * Tasks are their own rows now (schema v2). They used to be `- [ ]` lines
 * gathered out of every note, which meant a task could not exist without a note
 * to live in, its details were tokens inside a sentence, and ticking one rewrote
 * the note it was in. Notes still have checkboxes — they are useful in a note —
 * but those are formatting, not tasks.
 *
 * Pure, like the rest of `lib/`: every function that needs the time takes it.
 */
import type { Task } from "./ipc";
import {
  CLOSED_SECTIONS,
  compareDone,
  compareTasks,
  DONE_WINDOW_MS,
  dueOf,
  dueSection,
  isClosed,
  reminderAt,
  SECTIONS,
  taskSection,
  type DueSection,
} from "./taskMeta";

export interface TaskSection {
  kind: DueSection;
  tasks: Task[];
}

/**
 * The visible list: in-progress tasks first, then grouped by when each task is
 * due, each group in its own order, and empty groups left out.
 *
 * Closed tasks appear in Done or Cancelled for a day and then stop being shown.
 * They are not deleted — finishing something is not a reason to lose the record,
 * and neither is deciding against it — but a list of what is left should not be
 * mostly what is not.
 */
export function groupTasks(tasks: Task[], now: Date): TaskSection[] {
  const cutoff = now.getTime() - DONE_WINDOW_MS;
  const buckets = new Map<DueSection, Task[]>();

  for (const task of tasks) {
    if (isClosed(task) && (task.doneAt ?? 0) < cutoff) {
      continue;
    }
    const kind = taskSection(task, now);
    const bucket = buckets.get(kind);
    if (bucket === undefined) {
      buckets.set(kind, [task]);
    } else {
      bucket.push(task);
    }
  }

  return SECTIONS.flatMap((kind) => {
    const bucket = buckets.get(kind);
    if (bucket === undefined || bucket.length === 0) {
      return [];
    }
    return [
      {
        kind,
        tasks: [...bucket].sort(
          CLOSED_SECTIONS.includes(kind) ? compareDone : compareTasks,
        ),
      },
    ];
  });
}

/**
 * The tasks a search matches: the title, and the free-text notes under it,
 * because something worth writing down there is worth finding.
 *
 * Plain case-insensitive substring matching, as the notes' search is (brief
 * 6.6); ranking and highlighting are a job for FTS5, not for this.
 */
export function filterTasks(tasks: Task[], query: string): Task[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return tasks;
  }
  return tasks.filter(
    (task) =>
      task.title.toLowerCase().includes(needle) || task.notes.toLowerCase().includes(needle),
  );
}

/**
 * How many tasks are still work, for the tab's count: open and in progress, and
 * not the ones that closed either way.
 */
export function openTaskCount(tasks: Task[]): number {
  return tasks.filter((task) => !isClosed(task)).length;
}

/**
 * Open tasks that are due before now: what the tab's count is really about.
 *
 * Asked of the date rather than of the section, so a task being worked on now —
 * which the list lifts out of Overdue and into In progress — is still counted as
 * late, because it is.
 */
export function overdueCount(tasks: Task[], now: Date): number {
  return tasks.filter(
    (task) => !isClosed(task) && dueSection(dueOf(task), now) === "overdue",
  ).length;
}

export interface Reminder {
  /** Stable while the task and its due time are unchanged, so it fires once. */
  id: string;
  /** Unix milliseconds. */
  at: number;
  title: string;
  body: string;
}

/**
 * A reminder for every open task with a due date: at its time, or 09:00 for a
 * whole-day task. Rust schedules and shows them (`reminders_set`); working out
 * when "the 20th at 2 pm" is stays here, where the timezone is.
 *
 * Cancelled counts as closed here, as it does everywhere: being reminded about
 * something you decided not to do is the clearest way for a status to be a lie.
 *
 * The id carries the due date and time, so moving a task re-arms it and leaving
 * it alone does not.
 */
export function taskReminders(tasks: Task[]): Reminder[] {
  return tasks.flatMap((task) => {
    const due = dueOf(task);
    if (isClosed(task) || due === null) {
      return [];
    }
    const title = task.title.trim() || "Task";
    return [
      {
        id: `${task.id}|${due.date}|${due.time ?? ""}`,
        at: reminderAt(due),
        title,
        body: due.time === null ? "Due today" : "Due now",
      },
    ];
  });
}
