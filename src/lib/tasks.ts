/**
 * The Tasks tab's model: every checklist item in every note, gathered in one
 * place. There is no separate task store — a task is a `- [ ]` line in a note, so
 * it stays searchable, exportable and colour-coded with the note it belongs to.
 * Pure, like the rest of `lib/`.
 */
import type { Note } from "./ipc";
import { parseInline, parseLine, plainText, toggleTaskLine } from "./markdown";
import { sortNotes } from "./notes";
import { parseTaskText, reminderAt, repeatOnTick, type TaskMeta } from "./taskMeta";

export interface Task {
  noteId: string;
  /** Line index in the note's content, which is what `toggleTaskLine` takes. */
  line: number;
  /** The whole task text, tokens included. */
  text: string;
  checked: boolean;
  /** Title and details read from `text`. */
  meta: TaskMeta;
}

export interface TaskGroup {
  note: Note;
  /** The note's title with markers stripped, for the group heading. */
  title: string;
  tasks: Task[];
}

/**
 * Notes that contain at least one task, in the list's own order (locked first,
 * then most recently edited), each with its tasks in the order they are written.
 * Empty task lines are left out: there is nothing to tick.
 */
export function collectTasks(notes: Note[]): TaskGroup[] {
  const groups: TaskGroup[] = [];
  for (const note of sortNotes(notes)) {
    const tasks: Task[] = [];
    let title = "";
    note.content.split("\n").forEach((raw, line) => {
      const parsed = parseLine(raw);
      const text = parsed.text.trim();
      if (text === "") {
        return;
      }
      if (title === "") {
        title = plainText(parseInline(text));
      }
      if (parsed.kind === "task") {
        tasks.push({
          noteId: note.id,
          line,
          text,
          checked: parsed.checked,
          meta: parseTaskText(text),
        });
      }
    });
    if (tasks.length > 0) {
      groups.push({ note, title: title || "New note", tasks });
    }
  }
  return groups;
}

/**
 * Tick or untick the task on line `index`. Ticking a repeating task moves it to
 * its next date and leaves it open instead, wherever it is ticked from — a card,
 * the reader or the Tasks tab. Null when that line is not a task.
 */
export function tickTask(content: string, index: number, now: Date): string | null {
  const lines = content.split("\n");
  const raw = lines[index];
  if (raw === undefined) {
    return null;
  }
  const line = parseLine(raw);
  if (line.kind !== "task") {
    return null;
  }
  if (!line.checked) {
    const moved = repeatOnTick(line.text, now);
    if (moved !== null) {
      lines[index] = line.prefix + moved;
      return lines.join("\n");
    }
  }
  return toggleTaskLine(content, index);
}

/** Replace the text of the task on line `index`, keeping its box and indent. */
export function setTaskText(content: string, index: number, text: string): string | null {
  const lines = content.split("\n");
  const raw = lines[index];
  if (raw === undefined) {
    return null;
  }
  const line = parseLine(raw);
  const clean = text.replace(/\s+/g, " ").trim();
  if (line.kind !== "task" || clean === "") {
    return null;
  }
  lines[index] = line.prefix + clean;
  return lines.join("\n");
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
 * whole-day task. Rust schedules and shows them (`reminders_set`); the parsing
 * stays here, in one place.
 */
export function taskReminders(notes: Note[]): Reminder[] {
  return collectTasks(notes).flatMap((group) =>
    group.tasks.flatMap((task) => {
      const { due, title } = task.meta;
      if (task.checked || due === null) {
        return [];
      }
      const name = plainText(parseInline(title)) || "Task";
      return [
        {
          id: `${task.noteId}|${name}|${due.date}|${due.time ?? ""}`,
          at: reminderAt(due),
          title: name,
          body: due.time === null ? `Due today · ${group.title}` : `Due now · ${group.title}`,
        },
      ];
    }),
  );
}

/** How many tasks are still open, for the tab's count. */
export function openTaskCount(notes: Note[]): number {
  return collectTasks(notes).reduce(
    (count, group) => count + group.tasks.filter((task) => !task.checked).length,
    0,
  );
}

/** The title of the note new tasks are added to, and of the one made for them. */
export const TASKS_NOTE_TITLE = "Tasks";

/**
 * Titles that also mark that note: the tab was called To-Do at first, and a note
 * made then should keep collecting tasks rather than a second one being started.
 */
const TASKS_NOTE_TITLES = new Set(["tasks", "to-do"]);

/**
 * The note "Add a task" appends to: the first note, in list order, titled "Tasks"
 * (or "To-Do"), in any case, formatting ignored. Found by title rather than by a
 * stored id so it is visible and under the user's control — rename the note and
 * the next task starts a fresh one.
 */
export function findTodoNote(notes: Note[]): Note | undefined {
  return sortNotes(notes).find((note) => {
    const first = note.content.split("\n").find((line) => line.trim() !== "");
    if (first === undefined) {
      return false;
    }
    const title = plainText(parseInline(parseLine(first).text.trim()));
    return TASKS_NOTE_TITLES.has(title.toLowerCase());
  });
}

/** One task line from whatever was typed: a single trimmed line, or null if blank. */
export function taskLine(text: string): string | null {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean === "" ? null : `- [ ] ${clean}`;
}

/** Append a task to a note, after its last non-blank line. */
export function appendTask(content: string, text: string): string | null {
  const line = taskLine(text);
  if (line === null) {
    return null;
  }
  const kept = content.replace(/\s+$/, "");
  return kept === "" ? line : `${kept}\n${line}`;
}

/** The content of a brand-new Tasks note holding its first task. */
export function newTodoNote(text: string): string | null {
  const line = taskLine(text);
  return line === null ? null : `${TASKS_NOTE_TITLE}\n${line}`;
}
