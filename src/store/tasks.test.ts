import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Task } from "../lib/ipc";

const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invoke(command, args),
}));

const { useTasksStore } = await import("./tasks");

let made = 0;
function task(fields: Partial<Task> = {}): Task {
  made += 1;
  return {
    id: `t${String(made)}`,
    title: `task ${String(made)}`,
    notes: "",
    doneAt: null,
    dueDate: null,
    dueTime: null,
    priority: null,
    repeat: null,
    createdAt: made,
    updatedAt: made,
    ...fields,
  };
}

function calls(command: string): Record<string, unknown>[] {
  return invoke.mock.calls
    .filter(([name]) => name === command)
    .map(([, args]) => args as Record<string, unknown>);
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((command: string, args?: unknown) => {
    if (command === "tasks_create") {
      const { patch } = args as { patch: Partial<Task> };
      return Promise.resolve(task({ id: "created", ...patch }));
    }
    if (command === "tasks_update") {
      const { id, patch } = args as { id: string; patch: Partial<Task> };
      return Promise.resolve(task({ id, ...patch }));
    }
    if (command === "tasks_set_done") {
      const { id, done } = args as { id: string; done: boolean };
      return Promise.resolve(task({ id, doneAt: done ? 5_000 : null }));
    }
    return Promise.resolve(null);
  });
  useTasksStore.setState({
    tasks: [],
    loaded: true,
    draft: "",
    editingId: null,
    detailsId: null,
    pendingUndo: null,
  });
});

describe("adding", () => {
  it("reads the quick-entry tokens into fields and clears the draft", async () => {
    useTasksStore.setState({ draft: "call the bank !high @2026-09-20 14:00 repeat:weekly" });
    await useTasksStore.getState().add();

    expect(calls("tasks_create")).toEqual([
      {
        patch: {
          title: "call the bank",
          priority: "high",
          dueDate: "2026-09-20",
          dueTime: "14:00",
          repeat: "weekly",
        },
      },
    ]);
    expect(useTasksStore.getState().draft).toBe("");
    expect(useTasksStore.getState().tasks).toHaveLength(1);
  });

  it("ignores a draft with no words in it", async () => {
    useTasksStore.setState({ draft: "   " });
    await useTasksStore.getState().add();
    expect(calls("tasks_create")).toEqual([]);
  });

  /** What was typed is the user's, not ours to lose. */
  it("gives the text back when the write fails", async () => {
    invoke.mockRejectedValue(new Error("nope"));
    useTasksStore.setState({ draft: "renew passport" });
    await useTasksStore.getState().add();
    expect(useTasksStore.getState().draft).toBe("renew passport");
  });
});

describe("ticking", () => {
  it("completes an ordinary task", async () => {
    useTasksStore.setState({ tasks: [task({ id: "a" })] });
    await useTasksStore.getState().tick("a");

    expect(calls("tasks_set_done")).toEqual([{ id: "a", done: true }]);
    expect(useTasksStore.getState().tasks[0]?.doneAt).toBe(5_000);
  });

  it("reopens one that was done", async () => {
    useTasksStore.setState({ tasks: [task({ id: "a", doneAt: 1 })] });
    await useTasksStore.getState().tick("a");
    expect(calls("tasks_set_done")).toEqual([{ id: "a", done: false }]);
  });

  /**
   * Repeating means it comes back, not that it is ever finished. The next date
   * is worked out here because it is calendar arithmetic in the local timezone,
   * which Rust has no way to do.
   */
  it("moves a repeating task on instead of completing it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 14, 13, 30));
    useTasksStore.setState({
      tasks: [task({ id: "a", dueDate: "2026-09-14", dueTime: "09:00", repeat: "daily" })],
    });

    await useTasksStore.getState().tick("a");

    expect(calls("tasks_set_done")).toEqual([]);
    expect(calls("tasks_update")).toEqual([
      { id: "a", patch: { dueDate: "2026-09-15", dueTime: "09:00" } },
    ]);
    vi.useRealTimers();
  });

  it("catches a repeating task up rather than leaving it in the past", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 14, 13, 30));
    useTasksStore.setState({
      tasks: [task({ id: "a", dueDate: "2026-09-01", repeat: "daily" })],
    });

    await useTasksStore.getState().tick("a");

    expect(calls("tasks_update")).toEqual([
      { id: "a", patch: { dueDate: "2026-09-14", dueTime: null } },
    ]);
    vi.useRealTimers();
  });
});

describe("renaming", () => {
  it("writes a changed title, trimmed", async () => {
    useTasksStore.setState({ tasks: [task({ id: "a", title: "milk" })] });
    await useTasksStore.getState().setTitle("a", "  oat  milk ");
    expect(calls("tasks_update")).toEqual([{ id: "a", patch: { title: "oat milk" } }]);
  });

  /** Same rule as notes: reading something is not editing it. */
  it("does not write a title that has not changed", async () => {
    useTasksStore.setState({ tasks: [task({ id: "a", title: "milk" })] });
    await useTasksStore.getState().setTitle("a", "milk");
    expect(calls("tasks_update")).toEqual([]);
  });

  it("refuses to empty a task's title", async () => {
    useTasksStore.setState({ tasks: [task({ id: "a", title: "milk" })] });
    await useTasksStore.getState().setTitle("a", "   ");
    expect(calls("tasks_update")).toEqual([]);
  });
});

describe("deleting", () => {
  it("takes the row away at once and keeps the task for undo", async () => {
    useTasksStore.setState({ tasks: [task({ id: "a" }), task({ id: "b" })] });
    await useTasksStore.getState().remove("a");

    expect(useTasksStore.getState().tasks.map((entry) => entry.id)).toEqual(["b"]);
    expect(useTasksStore.getState().pendingUndo?.task.id).toBe("a");
    expect(calls("tasks_delete")).toEqual([{ id: "a" }]);
  });

  it("closes a details sheet that was open on it", async () => {
    useTasksStore.setState({ tasks: [task({ id: "a" })], detailsId: "a" });
    await useTasksStore.getState().remove("a");
    expect(useTasksStore.getState().detailsId).toBeNull();
  });

  it("puts it back on undo", async () => {
    const restored = task({ id: "a", title: "back" });
    invoke.mockImplementation((command: string) =>
      command === "tasks_restore" ? Promise.resolve(restored) : Promise.resolve(null),
    );
    useTasksStore.setState({ tasks: [], pendingUndo: { task: restored } });

    await useTasksStore.getState().undoRemove();

    expect(calls("tasks_restore")).toEqual([{ id: "a" }]);
    expect(useTasksStore.getState().tasks.map((entry) => entry.id)).toEqual(["a"]);
    expect(useTasksStore.getState().pendingUndo).toBeNull();
  });
});
