import { create } from "zustand";

import {
  tasksCreate,
  tasksDelete,
  tasksList,
  tasksRestore,
  tasksSetDone,
  tasksUpdate,
  type Task,
  type TaskPatch,
} from "../lib/ipc";
import { isDone, nextOccurrence, parseTaskText, dueOf, type DueSection } from "../lib/taskMeta";

/** Brief 6.9's undo window, shared with notes: long enough to change your mind. */
const UNDO_MS = 5_000;

let undoTimer: ReturnType<typeof setTimeout> | undefined;

interface PendingUndo {
  task: Task;
}

interface TasksStore {
  tasks: Task[];
  loaded: boolean;
  /** What is typed in the "Add a task" field. */
  draft: string;
  /** The task whose title is being edited in place. */
  editingId: string | null;
  /** The task whose details sheet is open. */
  detailsId: string | null;
  /**
   * Sections the reader has folded away. Kept for the session rather than
   * stored: which part of a list you are looking at is where you are, not a
   * preference, and it should not follow you into next week.
   */
  collapsed: ReadonlySet<DueSection>;
  pendingUndo: PendingUndo | null;

  load: () => Promise<void>;
  setDraft: (text: string) => void;
  add: () => Promise<void>;
  tick: (id: string) => Promise<void>;
  patch: (id: string, patch: TaskPatch) => Promise<void>;
  setTitle: (id: string, title: string) => Promise<void>;
  startEditing: (id: string | null) => void;
  openDetails: (id: string | null) => void;
  toggleSection: (kind: DueSection) => void;
  remove: (id: string) => Promise<void>;
  undoRemove: () => Promise<void>;
}

/** Replace one task in the list, leaving the order alone. */
function replace(tasks: Task[], updated: Task): Task[] {
  return tasks.map((task) => (task.id === updated.id ? updated : task));
}

export const useTasksStore = create<TasksStore>((set, get) => ({
  tasks: [],
  loaded: false,
  draft: "",
  editingId: null,
  detailsId: null,
  // Done starts folded: a list of what is left should not open on what is not.
  collapsed: new Set<DueSection>(["done"]),
  pendingUndo: null,

  load: async () => {
    try {
      set({ tasks: await tasksList(), loaded: true });
    } catch (error: unknown) {
      // An empty list is wrong but harmless; a panel that will not paint is not.
      console.error("tasks: load failed", error);
      set({ loaded: true });
    }
  },

  setDraft: (text) => {
    set({ draft: text });
  },

  /**
   * Add what is typed. The tokens the old format used still work here — typing
   * "Call the bank !high @tomorrow 2pm" sets the details — but they are read
   * once, on the way in, and stored as fields rather than kept in the text.
   */
  add: async () => {
    const text = get().draft;
    const quick = parseTaskText(text, new Date());
    if (quick.title === "") {
      return;
    }

    set({ draft: "" });
    try {
      const task = await tasksCreate({
        title: quick.title,
        priority: quick.priority,
        dueDate: quick.due?.date ?? null,
        dueTime: quick.due?.time ?? null,
        repeat: quick.repeat,
      });
      set((state) => ({ tasks: [...state.tasks, task] }));
    } catch (error: unknown) {
      // Put the text back rather than swallow what was typed.
      console.error("tasks: create failed", error);
      set({ draft: text });
    }
  },

  /**
   * Tick or untick.
   *
   * A repeating task is never completed: it moves to its next date and stays
   * open, which is what repeating means. Rust does not do this because the next
   * date is calendar arithmetic in the reader's own timezone.
   */
  tick: async (id) => {
    const task = get().tasks.find((candidate) => candidate.id === id);
    if (task === undefined) {
      return;
    }

    try {
      if (!isDone(task) && task.repeat !== null) {
        const next = nextOccurrence(dueOf(task), task.repeat, new Date());
        const moved = await tasksUpdate(id, { dueDate: next.date, dueTime: next.time });
        set((state) => ({ tasks: replace(state.tasks, moved) }));
        return;
      }
      const updated = await tasksSetDone(id, !isDone(task));
      set((state) => ({ tasks: replace(state.tasks, updated) }));
    } catch (error: unknown) {
      console.error("tasks: tick failed", error);
      void get().load();
    }
  },

  patch: async (id, patch) => {
    try {
      const updated = await tasksUpdate(id, patch);
      set((state) => ({ tasks: replace(state.tasks, updated) }));
    } catch (error: unknown) {
      console.error("tasks: update failed", error);
      void get().load();
    }
  },

  /**
   * Rename in place. A title that has not changed is not written: `updated_at`
   * is what the list falls back on for order, so saving what was only read would
   * move a task for having been looked at — the same rule notes follow.
   */
  setTitle: async (id, title) => {
    const task = get().tasks.find((candidate) => candidate.id === id);
    const clean = title.replace(/\s+/g, " ").trim();
    if (task === undefined || clean === "" || clean === task.title) {
      return;
    }
    await get().patch(id, { title: clean });
  },

  startEditing: (id) => {
    set({ editingId: id });
  },

  openDetails: (id) => {
    set({ detailsId: id });
  },

  toggleSection: (kind) => {
    set((state) => {
      const next = new Set(state.collapsed);
      if (!next.delete(kind)) {
        next.add(kind);
      }
      return { collapsed: next };
    });
  },

  /**
   * Soft delete, with the task kept for the undo toast. The row goes at once —
   * an undo is a better answer than a confirmation (brief 6.9).
   */
  remove: async (id) => {
    const task = get().tasks.find((candidate) => candidate.id === id);
    if (task === undefined) {
      return;
    }

    set((state) => ({
      tasks: state.tasks.filter((candidate) => candidate.id !== id),
      editingId: state.editingId === id ? null : state.editingId,
      detailsId: state.detailsId === id ? null : state.detailsId,
      pendingUndo: { task },
    }));

    try {
      await tasksDelete(id);
    } catch (error: unknown) {
      console.error("tasks: delete failed", error);
      set({ pendingUndo: null });
      void get().load();
      return;
    }

    if (undoTimer !== undefined) {
      clearTimeout(undoTimer);
    }
    undoTimer = setTimeout(() => {
      set({ pendingUndo: null });
    }, UNDO_MS);
  },

  undoRemove: async () => {
    const pending = get().pendingUndo;
    if (!pending) {
      return;
    }
    if (undoTimer !== undefined) {
      clearTimeout(undoTimer);
      undoTimer = undefined;
    }
    set({ pendingUndo: null });

    try {
      const restored = await tasksRestore(pending.task.id);
      set((state) => ({ tasks: [...state.tasks, restored] }));
    } catch (error: unknown) {
      console.error("tasks: restore failed", error);
      void get().load();
    }
  },
}));
