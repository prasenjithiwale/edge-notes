import { create } from "zustand";

import {
  notesCreate,
  notesDelete,
  notesList,
  notesReorder,
  notesRestore,
  notesSetPinned,
  notesUpdate,
  type Note,
  type NoteColor,
} from "../lib/ipc";
import { refreshArchive } from "./archive";
import { toggleTaskLine } from "../lib/markdown";
import { imageMarkdown } from "../lib/images";
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

/**
 * The note's text when the editor opened on it, so a click outside can tell a
 * note that was only looked at from one that was written in. Not state: nothing
 * renders from it.
 */
let editBaseline: { id: string; content: string } | null = null;

/**
 * The list in the order it is meant to be in. The manual order is a setting, and
 * this is the only thing that reads it, so the store and `db::notes::list`
 * cannot end up sorting differently (idea 16).
 */
function sorted(notes: Note[]): Note[] {
  return sortNotes(notes, useSettingsStore.getState().settings["notes.manualOrder"]);
}

function beginEdit(id: string, content: string) {
  editBaseline = { id, content };
}

interface PendingUndo {
  note: Note;
}

/** The panel's tabs. `"todo"` is the Tasks tab, named before it was renamed. */
export type PanelView = "notes" | "todo" | "focus" | "clips";

interface NotesStore {
  notes: Note[];
  view: PanelView;
  loaded: boolean;
  editingId: string | null;
  /**
   * The note shown in the large panel, or null for the normal list. It is shown
   * in the editor when it is also `editingId`, and read-only otherwise.
   */
  expandedId: string | null;
  pendingUndo: PendingUndo | null;
  /** Whether the header shows the search field instead of the title (brief 6.6). */
  searching: boolean;
  query: string;
  /** Palette id, or null for "All" (brief 6.7). */
  colorFilter: NoteColor | null;
  /** A `#tag` the notes must carry, without the hash, or null for all (idea 16). */
  tagFilter: string | null;

  load: () => Promise<void>;
  createNote: () => Promise<void>;
  /**
   * A new note holding pictures that were dropped on the panel (idea 17). Only
   * when no editor is open — while one is, the drop goes into the note being
   * written, which the editor's own plugin does.
   */
  createWithImages: (names: string[]) => Promise<void>;
  /** A new note that already says something, opened in the editor. */
  createWithContent: (content: string) => Promise<void>;
  setContent: (id: string, content: string) => void;
  setColor: (id: string, color: NoteColor) => Promise<void>;
  setPinned: (id: string, pinned: boolean) => Promise<void>;
  /**
   * Tick or untick a checkbox on line `line` of a note. Notes keep markdown
   * checkboxes for ad-hoc lists; they are formatting, and the Tasks tab knows
   * nothing about them.
   */
  toggleTask: (id: string, line: number) => void;
  flush: (id: string) => Promise<void>;
  /** Write everything still pending, before quitting (brief 11: flush on quit). */
  flushAll: () => Promise<void>;
  startEditing: (id: string) => void;
  stopEditing: () => Promise<void>;
  /**
   * Leave the editor after a click outside it, but only if the text is what it
   * was when the editor opened. Once something has been typed, a stray click
   * must not end the edit; Done and Esc still do.
   */
  leaveEditorIfUnchanged: () => Promise<void>;
  /** Show a note in the large panel, in the editor when `edit` is true. */
  expand: (id: string, options: { edit: boolean }) => Promise<void>;
  /** Back to the list. An open editor stays open, at its normal size. */
  shrink: () => void;
  remove: (id: string) => Promise<void>;
  undoRemove: () => Promise<void>;
  dismissUndo: () => void;

  /** Switch tabs. Leaving Notes closes the editor, search and an expanded note. */
  setView: (view: PanelView) => Promise<void>;

  openSearch: () => void;
  closeSearch: () => void;
  setQuery: (query: string) => void;
  setColorFilter: (color: NoteColor | null) => void;
  setTagFilter: (tag: string | null) => void;
  /**
   * Put the list in the order `ids` gives, and keep it that way. The first call
   * is what turns the manual order on — dragging a card is someone saying where
   * it goes, and asking them to find a setting first would be asking twice.
   */
  reorder: (ids: string[]) => Promise<void>;
}

export const useNotesStore = create<NotesStore>((set, get) => ({
  notes: [],
  view: "notes",
  loaded: false,
  editingId: null,
  expandedId: null,
  pendingUndo: null,
  searching: false,
  query: "",
  colorFilter: null,
  tagFilter: null,

  load: async () => {
    try {
      const notes = await notesList();
      savedContent.clear();
      for (const note of notes) {
        savedContent.set(note.id, note.content);
      }
      set({ notes: sorted(notes), loaded: true });
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
    const wasExpanded = get().expandedId !== null;
    await get().stopEditing();

    // A new note is empty and carries the last-used colour, so any active search
    // or colour filter would hide the card the editor is supposed to open in.
    // Clearing the filters keeps the new note visible (brief 6.9).
    set({ searching: false, query: "", colorFilter: null, view: "notes" });

    const color = useSettingsStore.getState().lastColor();
    try {
      const note = await notesCreate(color);
      savedContent.set(note.id, note.content);
      beginEdit(note.id, note.content);
      // Straight to the top and into the editor (brief 6.9) — and into the large
      // panel if a note was expanded, rather than hiding the new note behind it.
      set((state) => ({
        notes: [note, ...state.notes],
        editingId: note.id,
        expandedId: wasExpanded ? note.id : null,
      }));
    } catch (error: unknown) {
      console.error("notes: create failed", error);
    }
  },

  createWithImages: async (names) => {
    if (names.length === 0) {
      return;
    }
    // Everything a new note does, and then the pictures already in it: the
    // editor opens on a note that is not empty, so it is never discarded on the
    // way out even if nothing is typed.
    await get().createWithContent(names.map((name) => imageMarkdown(name)).join("\n"));
  },

  createWithContent: async (content) => {
    await get().createNote();
    const id = get().editingId;
    if (id === null) {
      return;
    }
    get().setContent(id, content);
    beginEdit(id, content);
    await get().flush(id);
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
        return { notes: state.editingId === null ? sorted(notes) : notes };
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

  toggleTask: (id, line) => {
    const note = get().notes.find((candidate) => candidate.id === id);
    const content = note ? toggleTaskLine(note.content, line) : null;
    if (content === null || content === note?.content) {
      return;
    }
    // A tick is an edit like any other: debounced, flushed on quit, and — like
    // typing — it does not re-sort the list under the cursor.
    get().setContent(id, content);
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
    const note = get().notes.find((candidate) => candidate.id === id);
    if (get().editingId !== id) {
      beginEdit(id, note?.content ?? "");
    }
    set({ editingId: id });
  },

  leaveEditorIfUnchanged: async () => {
    const { editingId, notes } = get();
    if (editingId === null || editBaseline?.id !== editingId) {
      return;
    }
    const note = notes.find((candidate) => candidate.id === editingId);
    if (note && note.content === editBaseline.content) {
      await get().stopEditing();
    }
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
        expandedId: state.expandedId === editingId ? null : state.expandedId,
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
    set((state) => ({ notes: sorted(state.notes) }));
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
      expandedId: state.expandedId === id ? null : state.expandedId,
      pendingUndo: { note },
    }));

    try {
      await notesDelete(id);
      refreshArchive();
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
      refreshArchive();
      savedContent.set(restored.id, restored.content);
      set((state) => ({ notes: sorted([...state.notes, restored]) }));
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

  expand: async (id, { edit }) => {
    const { editingId } = get();
    // One editor at a time: an editor left open on another note would sit hidden
    // behind the large panel, and an empty one would never be discarded.
    if (editingId !== null && editingId !== id) {
      await get().stopEditing();
    }
    if (edit && get().editingId !== id) {
      beginEdit(id, get().notes.find((candidate) => candidate.id === id)?.content ?? "");
    }
    set((state) => ({
      expandedId: id,
      editingId: edit ? id : state.editingId,
    }));
  },

  shrink: () => {
    set({ expandedId: null });
  },

  setView: async (view) => {
    if (view === get().view) {
      return;
    }
    if (view !== "notes") {
      // The editor lives in the Notes list; closing it properly discards an
      // empty note and releases its lock instead of leaving it open, unseen.
      await get().stopEditing();
    }
    // A search is about the list in front of you, so changing tabs ends it.
    set({ view, expandedId: null, searching: false, query: "" });
  },

  openSearch: () => {
    // Search filters whichever list is in front — the notes or the tasks — but
    // never the Focus tab, which is not a list, and never a note opened to read.
    const view = get().view === "focus" ? "notes" : get().view;
    set({ searching: true, expandedId: null, view });
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

  setTagFilter: (tag) => {
    // Pressing the selected chip again clears it, as the colour dots do.
    set((state) => ({
      tagFilter:
        state.tagFilter !== null && tag !== null && state.tagFilter.toLowerCase() === tag.toLowerCase()
          ? null
          : tag,
    }));
  },

  reorder: async (ids) => {
    const position = new Map(ids.map((id, index) => [id, index]));
    // Optimistic, and with the same numbers Rust is about to store, so the list
    // does not jump between the drop and the write landing.
    set((state) => ({
      notes: sortNotes(
        state.notes.map((note) => {
          const index = position.get(note.id);
          return index === undefined ? note : { ...note, sortOrder: index };
        }),
        true,
      ),
    }));
    try {
      await notesReorder(ids);
      await useSettingsStore.getState().patch({ "notes.manualOrder": true });
    } catch (error: unknown) {
      console.error("notes: reorder failed", error);
      // Whatever is stored is the truth; a failed write must not leave the list
      // showing an order nothing has.
      await get().load();
    }
  },
}));
