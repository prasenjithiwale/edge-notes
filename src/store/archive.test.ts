import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ArchivedItem } from "../lib/ipc";

const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invoke(command, args),
}));

const { useArchiveStore } = await import("./archive");
const { useNotesStore } = await import("./notes");
const { useTasksStore } = await import("./tasks");

function item(fields: Partial<ArchivedItem> & { id: string }): ArchivedItem {
  return {
    kind: "note",
    text: "Book flights",
    color: "mint",
    deletedAt: 1_000,
    purgeAt: 1_000 + 30 * 24 * 60 * 60 * 1000,
    ...fields,
  };
}

function calls(command: string): Record<string, unknown>[] {
  return invoke.mock.calls
    .filter(([name]) => name === command)
    .map(([, args]) => (args ?? {}) as Record<string, unknown>);
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((command: string) => {
    if (command === "archive_list") {
      return Promise.resolve([item({ id: "note-1" })]);
    }
    if (command === "notes_list" || command === "tasks_list") {
      return Promise.resolve([]);
    }
    return Promise.resolve(null);
  });
  useArchiveStore.setState({ items: [], loaded: false, restoringId: null });
  useNotesStore.setState({ notes: [], loaded: false });
  useTasksStore.setState({ tasks: [], loaded: false });
});

describe("loading", () => {
  it("reads what is deleted and not yet purged", async () => {
    await useArchiveStore.getState().load();

    expect(useArchiveStore.getState().items).toHaveLength(1);
    expect(useArchiveStore.getState().loaded).toBe(true);
  });

  /** An empty archive is wrong but harmless; a panel that will not paint is not. */
  it("comes up empty rather than throwing when the command fails", async () => {
    invoke.mockImplementation(() => Promise.reject(new Error("no")));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await useArchiveStore.getState().load();

    expect(useArchiveStore.getState().items).toEqual([]);
    expect(useArchiveStore.getState().loaded).toBe(true);
    quiet.mockRestore();
  });
});

describe("restoring", () => {
  it("puts a note back, re-reads the notes and drops the row", async () => {
    useArchiveStore.setState({ items: [item({ id: "note-1" })], loaded: true });

    await useArchiveStore.getState().restore(item({ id: "note-1" }));

    expect(calls("notes_restore")).toEqual([{ id: "note-1" }]);
    // Re-read rather than pushed in here: a restored note goes back where its
    // own timestamp puts it, which is deliberately not the top.
    expect(calls("notes_list")).toHaveLength(1);
    expect(useArchiveStore.getState().items).toEqual([]);
    expect(useArchiveStore.getState().restoringId).toBeNull();
  });

  it("sends a task through the task command instead", async () => {
    const task = item({ id: "task-1", kind: "task", text: "milk", color: null });
    useArchiveStore.setState({ items: [task], loaded: true });

    await useArchiveStore.getState().restore(task);

    expect(calls("tasks_restore")).toEqual([{ id: "task-1" }]);
    expect(calls("notes_restore")).toEqual([]);
    expect(calls("tasks_list")).toHaveLength(1);
  });

  /** Two presses on one row must not be two restores. */
  it("ignores a second restore while one is in flight", async () => {
    const first = item({ id: "note-1" });
    const second = item({ id: "note-2" });
    useArchiveStore.setState({ items: [first, second], loaded: true });

    await Promise.all([
      useArchiveStore.getState().restore(first),
      useArchiveStore.getState().restore(second),
    ]);

    expect(calls("notes_restore")).toEqual([{ id: "note-1" }]);
  });

  /** A failure leaves the list saying what is actually there. */
  it("reads the list again when a restore fails", async () => {
    invoke.mockImplementation((command: string) => {
      if (command === "notes_restore") {
        return Promise.reject(new Error("gone"));
      }
      if (command === "archive_list") {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    useArchiveStore.setState({ items: [item({ id: "note-1" })], loaded: true });

    await useArchiveStore.getState().restore(item({ id: "note-1" }));

    expect(useArchiveStore.getState().items).toEqual([]);
    expect(useArchiveStore.getState().restoringId).toBeNull();
    quiet.mockRestore();
  });
});
