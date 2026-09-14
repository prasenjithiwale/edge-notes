/**
 * The To-Do tab's model: every checklist item in every note, gathered in one
 * place. There is no separate task store — a task is a `- [ ]` line in a note, so
 * it stays searchable, exportable and colour-coded with the note it belongs to.
 * Pure, like the rest of `lib/`.
 */
import type { Note } from "./ipc";
import { parseInline, parseLine, plainText } from "./markdown";
import { sortNotes } from "./notes";

export interface Task {
  noteId: string;
  /** Line index in the note's content, which is what `toggleTaskLine` takes. */
  line: number;
  text: string;
  checked: boolean;
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
        tasks.push({ noteId: note.id, line, text, checked: parsed.checked });
      }
    });
    if (tasks.length > 0) {
      groups.push({ note, title: title || "New note", tasks });
    }
  }
  return groups;
}

/** How many tasks are still open, for the tab's count. */
export function openTaskCount(notes: Note[]): number {
  return collectTasks(notes).reduce(
    (count, group) => count + group.tasks.filter((task) => !task.checked).length,
    0,
  );
}

/** The title that marks the note new tasks are added to. */
export const TODO_NOTE_TITLE = "To-Do";

/**
 * The note "Add a task" appends to: the first note, in list order, whose title is
 * "To-Do" (any case, formatting ignored). Found by title rather than by a stored
 * id so it is visible and under the user's control — rename the note and the next
 * task starts a fresh one.
 */
export function findTodoNote(notes: Note[]): Note | undefined {
  return sortNotes(notes).find((note) => {
    const first = note.content.split("\n").find((line) => line.trim() !== "");
    if (first === undefined) {
      return false;
    }
    const title = plainText(parseInline(parseLine(first).text.trim()));
    return title.toLowerCase() === TODO_NOTE_TITLE.toLowerCase();
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

/** The content of a brand-new To-Do note holding its first task. */
export function newTodoNote(text: string): string | null {
  const line = taskLine(text);
  return line === null ? null : `${TODO_NOTE_TITLE}\n${line}`;
}
