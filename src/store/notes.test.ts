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
    pinned: false,
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

describe("pinning", () => {
  const OLDER = note({ id: "2", content: "Older", updatedAt: 500 });

  beforeEach(() => {
    useNotesStore.setState({ notes: [STORED, OLDER], editingId: null });
  });

  it("re-sorts at once from the list, so the pinned card moves to the top", async () => {
    await useNotesStore.getState().setPinned("2", true);
    expect(useNotesStore.getState().notes.map((n) => n.id)).toEqual(["2", "1"]);
  });

  it("does not re-sort while the editor is open, then does when it closes", async () => {
    // Pinning from the editor footer must not move the editor under the cursor.
    useNotesStore.getState().startEditing("2");
    await useNotesStore.getState().setPinned("2", true);
    expect(useNotesStore.getState().notes.map((n) => n.id)).toEqual(["1", "2"]);
    expect(useNotesStore.getState().notes[1]?.pinned).toBe(true);

    await useNotesStore.getState().stopEditing();
    expect(useNotesStore.getState().notes.map((n) => n.id)).toEqual(["2", "1"]);
  });

  it("rolls back when the pin could not be stored", async () => {
    invoke.mockRejectedValueOnce(new Error("database is locked"));
    await useNotesStore.getState().setPinned("2", true);
    expect(useNotesStore.getState().notes.map((n) => [n.id, n.pinned])).toEqual([
      ["1", false],
      ["2", false],
    ]);
  });
});

describe("flushAll, before quitting (brief 11)", () => {
  it("writes an edit the autosave debounce is still holding", async () => {
    useNotesStore.getState().setContent("1", "Groceries\nMilk and eggs");
    expect(updateCalls()).toEqual([]);

    await useNotesStore.getState().flushAll();
    expect(updateCalls().length).toBe(1);
  });

  it("discards an empty note left open in the editor rather than keeping it", async () => {
    useNotesStore.setState({
      notes: [note({ id: "blank", content: "" }), STORED],
      editingId: "blank",
    });

    await useNotesStore.getState().flushAll();

    const deleted = invoke.mock.calls.filter(([command]) => command === "notes_delete");
    expect(deleted.length).toBe(1);
    expect(useNotesStore.getState().editingId).toBeNull();
  });

  it("writes nothing when nothing is pending", async () => {
    await useNotesStore.getState().flushAll();
    expect(updateCalls()).toEqual([]);
  });
});
