import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Note } from "../lib/ipc";

const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invoke(command, args),
}));

const { useNotesStore } = await import("./notes");

function note(overrides: Partial<Note> & { id: string }): Note {
  return {
    content: "",
    color: "yellow",
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

const STORED = note({ id: "1", content: "Groceries\nMilk", updatedAt: 1_000 });

function updateCalls(): unknown[] {
  return invoke.mock.calls.filter(([command]) => command === "notes_update");
}

beforeEach(async () => {
  invoke.mockReset();
  invoke.mockImplementation((command: string, args?: unknown) => {
    if (command === "notes_list") {
      return Promise.resolve([STORED]);
    }
    if (command === "notes_update") {
      const { id } = args as { id: string };
      // Rust bumps updated_at on every write — that is the point.
      return Promise.resolve({ ...STORED, id, updatedAt: 9_999 });
    }
    return Promise.resolve(null);
  });
  useNotesStore.setState({ notes: [], loaded: false, editingId: null, pendingUndo: null });
  await useNotesStore.getState().load();
  invoke.mockClear();
});

/**
 * `notes_update` bumps `updated_at`, and the list sorts by it, so writing when
 * nothing changed moves a note to the top for having been read.
 */
describe("flush", () => {
  it("does not write when nothing was typed", async () => {
    await useNotesStore.getState().flush("1");
    expect(updateCalls()).toEqual([]);
  });

  it("writes once an edit exists", async () => {
    useNotesStore.getState().setContent("1", "Groceries\nMilk and eggs");
    await useNotesStore.getState().flush("1");
    expect(updateCalls().length).toBe(1);
  });

  it("does not write the same edit twice", async () => {
    useNotesStore.getState().setContent("1", "Groceries\nMilk and eggs");
    await useNotesStore.getState().flush("1");
    await useNotesStore.getState().flush("1");
    expect(updateCalls().length).toBe(1);
  });

  it("retries after a failed write rather than dropping the edit", async () => {
    invoke.mockRejectedValueOnce(new Error("database is locked"));
    useNotesStore.getState().setContent("1", "Groceries\nMilk and eggs");
    await useNotesStore.getState().flush("1");
    await useNotesStore.getState().flush("1");
    expect(updateCalls().length).toBe(2);
  });

  it("writes again when the text is edited back and forth", async () => {
    useNotesStore.getState().setContent("1", "Groceries\nMilk and eggs");
    await useNotesStore.getState().flush("1");
    // Back to exactly what is stored: there is nothing left to save.
    useNotesStore.getState().setContent("1", "Groceries\nMilk");
    await useNotesStore.getState().flush("1");
    expect(updateCalls().length).toBe(2);
  });
});

describe("opening a note without editing it", () => {
  it("leaves updated_at alone, so the note keeps its place in the list", async () => {
    useNotesStore.getState().startEditing("1");
    await useNotesStore.getState().stopEditing();

    expect(updateCalls()).toEqual([]);
    expect(useNotesStore.getState().notes[0]?.updatedAt).toBe(1_000);
  });

  it("still saves when the note was actually edited", async () => {
    useNotesStore.getState().startEditing("1");
    useNotesStore.getState().setContent("1", "Groceries\nMilk, eggs, coffee");
    await useNotesStore.getState().stopEditing();

    expect(updateCalls().length).toBe(1);
    expect(useNotesStore.getState().notes[0]?.updatedAt).toBe(9_999);
  });
});

describe("creating a second note", () => {
  it("discards the first one when it was left empty", async () => {
    // The shortcut and the tray both create notes without closing the editor
    // first; pressing the shortcut twice used to leave a blank card behind.
    invoke.mockImplementation((command: string) => {
      if (command === "notes_list") {
        return Promise.resolve([STORED]);
      }
      if (command === "notes_create") {
        return Promise.resolve(note({ id: "blank", content: "", updatedAt: 2_000 }));
      }
      if (command === "settings_get" || command === "settings_update") {
        return Promise.resolve({ "notes.lastColor": "yellow" });
      }
      return Promise.resolve(null);
    });

    await useNotesStore.getState().createNote();
    expect(useNotesStore.getState().editingId).toBe("blank");

    await useNotesStore.getState().createNote();

    const deleted = invoke.mock.calls.filter(([command]) => command === "notes_delete");
    expect(deleted.length).toBe(1);
    expect(useNotesStore.getState().notes.filter((n) => n.content === "").length).toBe(1);
  });
});
