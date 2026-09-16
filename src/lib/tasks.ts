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
  compareDone,
  compareTasks,
  DONE_WINDOW_MS,
  dueOf,
  isDone,
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
 * The visible list: grouped by when each task is due, each group in its own
 * order, and empty groups left out.
 *
 * Completed tasks appear in Done for a day and then stop being shown. They are
 * not deleted — finishing something is not a reason to lose the record — but a
 * list of what is left should not be mostly what is not.
 */
export function groupTasks(tasks: Task[], now: Date): TaskSection[] {
  const cutoff = now.getTime() - DONE_WINDOW_MS;
  const buckets = new Map<DueSection, Task[]>();

  for (const task of tasks) {
    if (isDone(task) && (task.doneAt ?? 0) < cutoff) {
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
        tasks: [...bucket].sort(kind === "done" ? compareDone : compareTasks),
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

/** How many tasks are still open, for the tab's count. */
export function openTaskCount(tasks: Task[]): number {
  return tasks.filter((task) => !isDone(task)).length;
}

/** Open tasks that are due before now: what the tab's count is really about. */
export function overdueCount(tasks: Task[], now: Date): number {
  return tasks.filter((task) => taskSection(task, now) === "overdue").length;
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
 * The id carries the due date and time, so moving a task re-arms it and leaving
 * it alone does not.
 */
export function taskReminders(tasks: Task[]): Reminder[] {
  return tasks.flatMap((task) => {
    const due = dueOf(task);
    if (isDone(task) || due === null) {
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
