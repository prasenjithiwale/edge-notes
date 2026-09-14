import { create } from "zustand";

import {
  notesCreate,
  notesDelete,
  notesList,
  notesRestore,
  notesSetPinned,
  notesUpdate,
  type Note,
  type NoteColor,
} from "../lib/ipc";
import { isNoteEmpty, sortNotes } from "../lib/notes";
import { useSettingsStore } from "./settings";

/** Brief 6.9: autosave debounce. */
const AUTOSAVE_MS = 400;
/** Brief 6.9: how long the undo toast stays up. */
const UNDO_MS = 5_000;

/** Pending autosaves, keyed by note id. Timers are not state, so they live here. */
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
let undoTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * What is already in the database for each note, so `flush` can tell a real edit
 * from a no-op. Without it, closing a note you only read still sent
 * `notes_update`, which bumps `updated_at` and jumps the note to the top of the
 * list — merely looking at a note reordered it. Same reasoning as restore
 * deliberately leaving `updated_at` alone.
 */
const savedContent = new Map<string, string>();

interface PendingUndo {
  note: Note;
}

interface NotesStore {
  notes: Note[];
  loaded: boolean;
  editingId: string | null;
  pendingUndo: PendingUndo | null;
  /** Whether the header shows the search field instead of the title (brief 6.6). */
  searching: boolean;
  query: string;
  /** Palette id, or null for "All" (brief 6.7). */
  colorFilter: NoteColor | null;

  load: () => Promise<void>;
  createNote: () => Promise<void>;
  setContent: (id: string, content: string) => void;
  setColor: (id: string, color: NoteColor) => Promise<void>;
  setPinned: (id: string, pinned: boolean) => Promise<void>;
  flush: (id: string) => Promise<void>;
  /** Write everything still pending, before quitting (brief 11: flush on quit). */
  flushAll: () => Promise<void>;
  startEditing: (id: string) => void;
  stopEditing: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  undoRemove: () => Promise<void>;
  dismissUndo: () => void;

  openSearch: () => void;
  closeSearch: () => void;
  setQuery: (query: string) => void;
  setColorFilter: (color: NoteColor | null) => void;
}

export const useNotesStore = create<NotesStore>((set, get) => ({
  notes: [],
  loaded: false,
  editingId: null,
  pendingUndo: null,
  searching: false,
  query: "",
  colorFilter: null,

  load: async () => {
    try {
      const notes = await notesList();
      savedContent.clear();
      for (const note of notes) {
        savedContent.set(note.id, note.content);
      }
      set({ notes: sortNotes(notes), loaded: true });
    } catch (error: unknown) {
      console.error("notes: load failed", error);
      set({ loaded: true });
    }
  },

  createNote: async () => {
    // Close whatever is open first. Creating a note replaces the editor rather
    // than closing it — pressing the shortcut twice, say — and an empty note that
    // never goes through `stopEditing` is never discarded, so each press left
    // another blank card behind (brief 6.9).
    await get().stopEditing();

    // A new note is empty and carries the last-used colour, so any active search
    // or colour filter would hide the card the editor is supposed to open in.
    // Clearing the filters keeps the new note visible (brief 6.9).
    set({ searching: false, query: "", colorFilter: null });

    const color = useSettingsStore.getState().lastColor();
    try {
      const note = await notesCreate(color);
      savedContent.set(note.id, note.content);
      // Straight to the top and into the editor (brief 6.9).
      set((state) => ({ notes: [note, ...state.notes], editingId: note.id }));
    } catch (error: unknown) {
      console.error("notes: create failed", error);
    }
  },

  setContent: (id, content) => {
    // Optimistic, so the card and preview track every keystroke. The list is
    // deliberately *not* re-sorted here: a card that jumped to the top mid-
    // sentence would move out from under the cursor. Sorting happens when the
    // editor closes.
    set((state) => ({
      notes: state.notes.map((note) =>
        note.id === id ? { ...note, content } : note,
      ),
    }));

    const existing = saveTimers.get(id);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    saveTimers.set(
      id,
      setTimeout(() => {
        void get().flush(id);
      }, AUTOSAVE_MS),
    );
  },

  setColor: async (id, color) => {
    set((state) => ({
      notes: state.notes.map((note) =>
        note.id === id ? { ...note, color } : note,
      ),
    }));
    try {
      await notesUpdate(id, { color });
      await useSettingsStore.getState().patch({ "notes.lastColor": color });
    } catch (error: unknown) {
      console.error("notes: colour update failed", error);
    }
  },

  setPinned: async (id, pinned) => {
    // Optimistic. From a card the list re-sorts straight away: pinning is a
    // deliberate act, so seeing the card move is the point. With the editor
    // open it waits, like every other change, until `stopEditing` — pinning from
    // the editor footer must not pull the editor out from under the cursor.
    const withPin = (value: boolean) => {
      set((state) => {
        const notes = state.notes.map((note) =>
          note.id === id ? { ...note, pinned: value } : note,
        );
        return { notes: state.editingId === null ? sortNotes(notes) : notes };
      });
    };

    withPin(pinned);
    try {
      await notesSetPinned(id, pinned);
    } catch (error: unknown) {
      console.error("notes: pin failed", error);
      // Put it back: the list would otherwise claim a pin that was never stored.
      withPin(!pinned);
    }
  },

  /** Write pending content now: on blur, on close, and on the debounce firing. */
  flush: async (id) => {
    const timer = saveTimers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      saveTimers.delete(id);
    }
    const note = get().notes.find((candidate) => candidate.id === id);
    if (!note) {
      return;
    }
    // Nothing typed since the last write, so there is nothing to persist. The
    // write itself is what would reorder the list, so skipping it is the fix.
    if (savedContent.get(id) === note.content) {
      return;
    }
    try {
      const saved = await notesUpdate(id, { content: note.content });
      // Only on success: a failed write must stay pending so the next flush retries.
      savedContent.set(id, note.content);
      set((state) => ({
        notes: state.notes.map((candidate) =>
          candidate.id === id ? { ...candidate, updatedAt: saved.updatedAt } : candidate,
        ),
      }));
    } catch (error: unknown) {
      console.error("notes: save failed", error);
    }
  },

  flushAll: async () => {
    // Closing the editor rather than just flushing it, so an empty new note is
    // discarded instead of surviving the restart as a blank card (brief 6.9).
    await get().stopEditing();
    await Promise.all([...saveTimers.keys()].map((id) => get().flush(id)));
  },

  startEditing: (id) => {
    set({ editingId: id });
  },

  stopEditing: async () => {
    const { editingId, notes } = get();
    if (editingId === null) {
      return;
    }
    const note = notes.find((candidate) => candidate.id === editingId);
    set({ editingId: null });

    if (note && isNoteEmpty(note.content)) {
      // Brief 6.9: an empty note is discarded, with no undo toast — there is
      // nothing in it to regret losing.
      const timer = saveTimers.get(editingId);
      if (timer !== undefined) {
        clearTimeout(timer);
        saveTimers.delete(editingId);
      }
      savedContent.delete(editingId);
      set((state) => ({
        notes: state.notes.filter((candidate) => candidate.id !== editingId),
      }));
      try {
        await notesDelete(editingId);
      } catch (error: unknown) {
        console.error("notes: discard failed", error);
      }
      return;
    }

    await get().flush(editingId);
    // Safe to re-sort now that the cursor has left.
    set((state) => ({ notes: sortNotes(state.notes) }));
  },

  remove: async (id) => {
    const note = get().notes.find((candidate) => candidate.id === id);
    if (!note) {
      return;
    }
    savedContent.delete(id);
    set((state) => ({
      notes: state.notes.filter((candidate) => candidate.id !== id),
      editingId: state.editingId === id ? null : state.editingId,
      pendingUndo: { note },
    }));

    try {
      await notesDelete(id);
    } catch (error: unknown) {
      console.error("notes: delete failed", error);
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
      const restored = await notesRestore(pending.note.id);
      savedContent.set(restored.id, restored.content);
      set((state) => ({ notes: sortNotes([...state.notes, restored]) }));
    } catch (error: unknown) {
      console.error("notes: restore failed", error);
    }
  },

  dismissUndo: () => {
    if (undoTimer !== undefined) {
      clearTimeout(undoTimer);
      undoTimer = undefined;
    }
    set({ pendingUndo: null });
  },

  openSearch: () => {
    set({ searching: true });
  },

  /** Brief 6.6: Esc clears the query and returns the header to the title. */
  closeSearch: () => {
    set({ searching: false, query: "" });
  },

  setQuery: (query) => {
    set({ query });
  },

  setColorFilter: (color) => {
    // Clicking the selected dot again clears the filter (brief 6.7).
    set((state) => ({ colorFilter: state.colorFilter === color ? null : color }));
  },
}));
