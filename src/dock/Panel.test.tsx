// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { Note, Settings, Task } from "../lib/ipc";

const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invoke(command, args),
}));
type EventHandler = (event: { payload: unknown }) => void;
const listeners = new Map<string, EventHandler>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: EventHandler) => {
    listeners.set(event, handler);
    return Promise.resolve(() => listeners.delete(event));
  },
}));

const { Panel } = await import("./Panel");
const { useDockStore } = await import("../store/dock");
const { useNotesStore } = await import("../store/notes");
const { useTasksStore } = await import("../store/tasks");

function note(overrides: Partial<Note> & { id: string }): Note {
  return {
    content: "",
    color: "yellow",
    pinned: false,
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
    ...overrides,
  };
}

const NOTES: Note[] = [
  note({ id: "1", content: "Standup notes\nDeploy the fix", color: "pink", updatedAt: 30 }),
  note({ id: "2", content: "Groceries\nMilk and coffee", color: "blue", updatedAt: 20 }),
  note({ id: "3", content: "Book flights", color: "mint", updatedAt: 10 }),
];

let madeTask = 0;
function task(overrides: Partial<Task> = {}): Task {
  madeTask += 1;
  return {
    id: `task-${String(madeTask)}`,
    title: `task ${String(madeTask)}`,
    notes: "",
    doneAt: null,
    dueDate: null,
    dueTime: null,
    priority: null,
    repeat: null,
    createdAt: madeTask,
    updatedAt: madeTask,
    ...overrides,
  };
}

const SETTINGS: Settings = {
  "dock.side": "right",
  "dock.monitor": "primary",
  "dock.tabOffset": 0.5,
  "dock.openDelayMs": 120,
  "dock.closeDelayMs": 400,
  "dock.openOn": "hover",
  "tab.appearance": "translucent",
  "panel.width": 320,
  theme: "system",
  "notes.lastColor": "yellow",
  "shortcut.newNote": "CmdOrCtrl+Alt+N",
  "tasks.reminders": true,
  "panel.translucency": 0,
};

/** What `tasks_list` answers with, and what the write commands change. */
let tasksInDb: Task[] = [];

function commandCalls(command: string): unknown[] {
  return invoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args);
}

/** The panel is on screen; shortcuts are scoped to that. */
function openDock() {
  useDockStore.setState({ phase: "open", side: "right", tabTop: 0, keepOpen: false });
}

function press(key: string, init: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((command: string, args?: unknown) => {
    if (command === "notes_list") {
      return Promise.resolve(NOTES);
    }
    if (command === "settings_get" || command === "settings_update") {
      return Promise.resolve(SETTINGS);
    }
    if (command === "notes_create") {
      return Promise.resolve(note({ id: "new", color: "yellow", updatedAt: 40 }));
    }
    if (command === "tasks_list") {
      return Promise.resolve(tasksInDb);
    }
    if (command === "tasks_create") {
      const { patch } = args as { patch: Partial<Task> };
      const created = task({ id: `created-${String(madeTask + 1)}`, ...patch });
      tasksInDb = [...tasksInDb, created];
      return Promise.resolve(created);
    }
    if (command === "tasks_update") {
      const { id, patch } = args as { id: string; patch: Partial<Task> };
      const updated = { ...(tasksInDb.find((entry) => entry.id === id) ?? task()), ...patch };
      tasksInDb = tasksInDb.map((entry) => (entry.id === id ? updated : entry));
      return Promise.resolve(updated);
    }
    if (command === "tasks_set_done") {
      const { id, done } = args as { id: string; done: boolean };
      const found = tasksInDb.find((entry) => entry.id === id) ?? task();
      const updated = { ...found, doneAt: done ? 1_000 : null };
      tasksInDb = tasksInDb.map((entry) => (entry.id === id ? updated : entry));
      return Promise.resolve(updated);
    }
    return Promise.resolve(null);
  });
  useDockStore.setState({ locks: new Set(), large: false, panelWidth: 320 });
  tasksInDb = [];
  useTasksStore.setState({
    tasks: [],
    loaded: false,
    draft: "",
    editingId: null,
    detailsId: null,
    pendingUndo: null,
  });
  useNotesStore.setState({
    notes: [],
    view: "notes",
    loaded: false,
    editingId: null,
    expandedId: null,
    pendingUndo: null,
    searching: false,
    query: "",
    colorFilter: null,
  });
  openDock();
});

afterEach(() => {
  cleanup();
});

async function renderPanel() {
  render(<Panel className="" />);
  await screen.findByText("Standup notes");
}

describe("search", () => {
  it("filters the list to matching notes", async () => {
    await renderPanel();
    press("f", { metaKey: true });

    const field = await screen.findByLabelText("Search notes");
    // The header shows the field in place of the title (brief 6.6).
    expect(screen.queryByRole("tab", { name: "Notes" })).toBeNull();

    useNotesStore.getState().setQuery("coffee");
    await waitFor(() => {
      expect(screen.queryByText("Standup notes")).toBeNull();
    });
    expect(screen.getByText("Groceries")).toBeTruthy();
    expect(field).toBeTruthy();
  });

  it("shows the no-matches message with the query", async () => {
    await renderPanel();
    useNotesStore.setState({ searching: true, query: "penguin" });
    await waitFor(() => {
      expect(screen.getByText("No notes match “penguin”")).toBeTruthy();
    });
  });
});

describe("the Esc cascade (brief 6.11)", () => {
  it("closes the editor first, leaving the panel open", async () => {
    await renderPanel();
    useNotesStore.getState().startEditing("1");
    await screen.findByLabelText("Note content");

    press("Escape");

    await waitFor(() => {
      expect(useNotesStore.getState().editingId).toBeNull();
    });
    expect(commandCalls("dock_toggle")).toEqual([]);
  });

  it("closes search next, still leaving the panel open", async () => {
    await renderPanel();
    useNotesStore.setState({ searching: true, query: "milk" });

    press("Escape");

    await waitFor(() => {
      expect(useNotesStore.getState().searching).toBe(false);
    });
    // Brief 6.6: Esc clears the query and returns the header to the title.
    expect(useNotesStore.getState().query).toBe("");
    expect(commandCalls("dock_toggle")).toEqual([]);
  });

  it("collapses the panel once nothing else claims Esc", async () => {
    await renderPanel();
    press("Escape");
    await waitFor(() => {
      expect(commandCalls("dock_toggle").length).toBe(1);
    });
  });

  it("does nothing at all while the panel is collapsed", async () => {
    await renderPanel();
    // The webview can keep key focus after a collapse, and Esc must never
    // toggle a collapsed panel back open.
    useDockStore.setState({ phase: "collapsed" });

    press("Escape");
    press("n", { metaKey: true });
    press("f", { metaKey: true });

    await Promise.resolve();
    expect(commandCalls("dock_toggle")).toEqual([]);
    expect(commandCalls("notes_create")).toEqual([]);
    expect(useNotesStore.getState().searching).toBe(false);
  });
});

describe("colour filter", () => {
  it("filters to a colour and clears when the dot is clicked again", async () => {
    await renderPanel();
    const pink = await screen.findByRole("button", { name: "Pink" });

    pink.click();
    await waitFor(() => {
      expect(screen.queryByText("Groceries")).toBeNull();
    });
    expect(screen.getByText("Standup notes")).toBeTruthy();

    // Selecting one colour must not remove the dots needed to switch away.
    expect(screen.getByRole("button", { name: "Blue" })).toBeTruthy();

    pink.click();
    await waitFor(() => {
      expect(screen.getByText("Groceries")).toBeTruthy();
    });
  });

  it("offers only colours that some note uses", async () => {
    await renderPanel();
    await screen.findByRole("button", { name: "Pink" });
    expect(screen.queryByRole("button", { name: "Lavender" })).toBeNull();
  });
});

describe("the tray and the global shortcut", () => {
  it("creates a note when Rust sends ui:new-note", async () => {
    await renderPanel();
    // Brief 6.11: the shortcut opens the panel with a new note in the editor.
    // Rust has already shown the panel by the time the event arrives.
    listeners.get("ui:new-note")?.({ payload: null });

    await waitFor(() => {
      expect(commandCalls("notes_create").length).toBe(1);
    });
    expect(useNotesStore.getState().editingId).toBe("new");
  });
});

describe("new note", () => {
  it("clears an active search so the new card is not hidden", async () => {
    await renderPanel();
    useNotesStore.setState({ searching: true, query: "penguin" });

    press("n", { metaKey: true });

    await waitFor(() => {
      expect(commandCalls("notes_create").length).toBe(1);
    });
    expect(useNotesStore.getState().query).toBe("");
    expect(useNotesStore.getState().editingId).toBe("new");
  });
});

describe("quitting from the tray (brief 11: flush on quit)", () => {
  it("saves a pending edit before telling Rust it may exit", async () => {
    await renderPanel();
    useNotesStore.getState().setContent("1", "Standup notes\nDeploy the fix today");

    listeners.get("app:quit-requested")?.({ payload: null });

    await waitFor(() => {
      expect(commandCalls("app_quit").length).toBe(1);
    });
    const order = invoke.mock.calls.map(([command]) => command);
    expect(order.indexOf("notes_update")).toBeGreaterThan(-1);
    expect(order.indexOf("notes_update")).toBeLessThan(order.indexOf("app_quit"));
  });
});

/** Stand in for Rust: `dock_set_large` resizes and echoes the state back. */
function answerLargeLikeRust() {
  const fallback = invoke.getMockImplementation();
  invoke.mockImplementation((command: string, args?: unknown) => {
    if (command === "dock_set_large") {
      const { value } = args as { value: boolean };
      const dock = useDockStore.getState();
      dock.applyState({
        phase: dock.phase,
        side: dock.side,
        tabTop: dock.tabTop,
        keepOpen: dock.keepOpen,
        large: value,
        panelWidth: value ? 760 : 320,
      });
      return Promise.resolve(null);
    }
    return fallback ? fallback(command, args) : Promise.resolve(null);
  });
}

function contentOf(id: string): string | undefined {
  return useNotesStore.getState().notes.find((candidate) => candidate.id === id)?.content;
}

async function openEditorWith(content: string, selection: [number, number]) {
  await renderPanel();
  useNotesStore.getState().setContent("1", content);
  useNotesStore.getState().startEditing("1");
  const field = await screen.findByLabelText<HTMLTextAreaElement>("Note content");
  field.setSelectionRange(selection[0], selection[1]);
  return field;
}

describe("formatting in the editor", () => {
  it("bolds the selection with Cmd+B and keeps the text selected", async () => {
    const field = await openEditorWith("Standup notes", [0, 7]);

    fireEvent.keyDown(field, { key: "b", code: "KeyB", metaKey: true });

    await waitFor(() => {
      expect(contentOf("1")).toBe("**Standup** notes");
    });
    expect([field.selectionStart, field.selectionEnd]).toEqual([2, 9]);
  });

  it("turns the line into a checklist item with Cmd+Shift+9", async () => {
    const field = await openEditorWith("Groceries\nmilk", [12, 12]);

    fireEvent.keyDown(field, { key: "(", code: "Digit9", metaKey: true, shiftKey: true });

    await waitFor(() => {
      expect(contentOf("1")).toBe("Groceries\n- [ ] milk");
    });
  });

  it("continues a list on Enter, and leaves a plain Enter alone", async () => {
    const field = await openEditorWith("Groceries\n- milk", [16, 16]);

    const handled = !fireEvent.keyDown(field, { key: "Enter", code: "Enter" });
    expect(handled).toBe(true);
    await waitFor(() => {
      expect(contentOf("1")).toBe("Groceries\n- milk\n- ");
    });

    field.setSelectionRange(9, 9);
    // Not a list line: the browser inserts the newline itself.
    expect(fireEvent.keyDown(field, { key: "Enter", code: "Enter" })).toBe(true);
    // Shift+Enter is always a plain line break.
    field.setSelectionRange(16, 16);
    expect(fireEvent.keyDown(field, { key: "Enter", code: "Enter", shiftKey: true })).toBe(true);
  });

  it("does not continue a list while an input method is composing", async () => {
    const field = await openEditorWith("- milk", [6, 6]);
    expect(fireEvent.keyDown(field, { key: "Enter", code: "Enter", isComposing: true })).toBe(
      true,
    );
    expect(contentOf("1")).toBe("- milk");
  });

  it("formats from the toolbar", async () => {
    const field = await openEditorWith("Standup notes", [8, 13]);

    screen.getByRole("button", { name: "Strikethrough" }).click();

    await waitFor(() => {
      expect(contentOf("1")).toBe("Standup ~~notes~~");
    });
    expect(field.selectionStart).toBe(10);
  });

  it("ticks a checklist item from its card", async () => {
    await renderPanel();
    useNotesStore.getState().setContent("2", "Groceries\n- [ ] milk");

    const box = await screen.findByRole("checkbox", { name: "milk" });
    box.click();

    await waitFor(() => {
      expect(contentOf("2")).toBe("Groceries\n- [x] milk");
    });
    // Ticking is not opening.
    expect(useNotesStore.getState().editingId).toBeNull();
  });
});

describe("expanding a note", () => {
  it("opens an unpinned note in the large editor", async () => {
    answerLargeLikeRust();
    await renderPanel();

    const [expand] = screen.getAllByRole("button", { name: "Expand note" });
    expand?.click();

    await screen.findByRole("button", { name: "Shrink note" });
    expect(commandCalls("dock_set_large")).toContainEqual({ value: true });
    expect(useNotesStore.getState()).toMatchObject({ expandedId: "1", editingId: "1" });
    expect(screen.getByLabelText("Note content")).toBeTruthy();
    // The list and its chrome make way for the note.
    expect(screen.queryByText("Groceries")).toBeNull();
    expect(screen.queryByRole("button", { name: "Search notes" })).toBeNull();
    // Held open while reading, like the editor and search are.
    expect(useDockStore.getState().locks.has("expanded")).toBe(true);
  });

  it("opens a pinned note to read, with Edit as the way in", async () => {
    answerLargeLikeRust();
    await renderPanel();
    useNotesStore.setState((state) => ({
      notes: state.notes.map((candidate) =>
        candidate.id === "2" ? { ...candidate, pinned: true } : candidate,
      ),
    }));

    await useNotesStore.getState().expand("2", { edit: false });

    await screen.findByRole("button", { name: "Shrink note" });
    expect(screen.queryByLabelText("Note content")).toBeNull();
    expect(screen.getByText("Milk and coffee")).toBeTruthy();

    screen.getByRole("button", { name: "Edit note" }).click();
    await screen.findByLabelText("Note content");
  });

  it("backs out one level per Esc: editor, then the large panel", async () => {
    answerLargeLikeRust();
    await renderPanel();
    await useNotesStore.getState().expand("1", { edit: true });
    await screen.findByLabelText("Note content");

    press("Escape");
    // The editor closes into the reader, still large.
    await screen.findByRole("button", { name: "Edit note" });
    expect(useNotesStore.getState().expandedId).toBe("1");

    press("Escape");
    await screen.findByText("Groceries");
    expect(commandCalls("dock_set_large")).toContainEqual({ value: false });
    expect(useDockStore.getState().locks.has("expanded")).toBe(false);
    expect(commandCalls("dock_toggle")).toEqual([]);
  });

  it("ends when the panel collapses, so the next open shows the list", async () => {
    answerLargeLikeRust();
    await renderPanel();
    await useNotesStore.getState().expand("1", { edit: false });
    await screen.findByRole("button", { name: "Shrink note" });

    useDockStore.setState({ phase: "collapsed", large: false });

    await waitFor(() => {
      expect(useNotesStore.getState().expandedId).toBeNull();
    });
  });

  it("gives way to search, which needs the list", async () => {
    answerLargeLikeRust();
    await renderPanel();
    await useNotesStore.getState().expand("1", { edit: false });
    await screen.findByRole("button", { name: "Shrink note" });

    press("f", { metaKey: true });

    await screen.findByLabelText("Search notes");
    expect(useNotesStore.getState().expandedId).toBeNull();
  });
});

describe("clicking outside the editor", () => {
  function clickOn(element: Element) {
    fireEvent.pointerDown(element);
    fireEvent.click(element);
  }

  it("leaves edit mode when the note is unchanged", async () => {
    await renderPanel();
    useNotesStore.getState().startEditing("1");
    await screen.findByLabelText("Note content");

    clickOn(screen.getByRole("button", { name: "Keep open" }));

    await waitFor(() => {
      expect(useNotesStore.getState().editingId).toBeNull();
    });
  });

  it("stays in edit mode once something was typed", async () => {
    await renderPanel();
    useNotesStore.getState().startEditing("1");
    const field = await screen.findByLabelText("Note content");
    fireEvent.change(field, { target: { value: "Standup notes\nDeploy the fix today" } });

    clickOn(screen.getByRole("button", { name: "Keep open" }));

    await Promise.resolve();
    expect(useNotesStore.getState().editingId).toBe("1");
  });

  it("ignores clicks inside the note, and a selection dragged out of it", async () => {
    await renderPanel();
    useNotesStore.getState().startEditing("1");
    const field = await screen.findByLabelText("Note content");

    clickOn(screen.getByRole("button", { name: "Bold" }));
    clickOn(field);
    // Pressed inside, released outside: the click lands on a common ancestor.
    fireEvent.pointerDown(field);
    fireEvent.click(document.body);

    await Promise.resolve();
    expect(useNotesStore.getState().editingId).toBe("1");
  });

  it("opens the card that was clicked, after closing the unchanged one", async () => {
    await renderPanel();
    useNotesStore.getState().startEditing("1");
    await screen.findByLabelText("Note content");

    const groceries = screen.getByRole("button", { name: "Groceries" });
    fireEvent.pointerDown(groceries);
    groceries.click();

    await waitFor(() => {
      expect(useNotesStore.getState().editingId).toBe("2");
    });
  });
});

describe("the colour palette", () => {
  it("offers every colour behind More colours and applies the one picked", async () => {
    await renderPanel();
    useNotesStore.getState().startEditing("1");
    await screen.findByLabelText("Note content");

    // The quick row: at most seven plus the palette button.
    const quickRow = screen.getByRole("group", { name: "Note colour" });
    expect(quickRow.querySelectorAll("button[aria-pressed]").length).toBeLessThanOrEqual(8);
    expect(screen.queryByRole("group", { name: "All colours" })).toBeNull();

    screen.getByRole("button", { name: "More colours" }).click();
    const grid = await screen.findByRole("group", { name: "All colours" });
    expect(grid.querySelectorAll("button")).toHaveLength(16);

    const teal = Array.from(grid.querySelectorAll("button")).find(
      (button) => button.getAttribute("aria-label") === "Teal",
    );
    teal?.click();

    await waitFor(() => {
      expect(commandCalls("notes_update")).toContainEqual(
        expect.objectContaining({ id: "1", color: "teal" }),
      );
    });
    // The grid closes, and the picked colour joins the quick row, selected.
    await waitFor(() => {
      expect(screen.queryByRole("group", { name: "All colours" })).toBeNull();
    });
    const picked = within(screen.getByRole("group", { name: "Note colour" })).getByRole(
      "button",
      { name: "Teal" },
    );
    expect(picked.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("the Tasks tab", () => {
  async function withTasks(...tasks: Task[]) {
    tasksInDb = tasks;
    await renderPanel();
    await waitFor(() => {
      expect(useTasksStore.getState().loaded).toBe(true);
    });
  }

  it("counts open tasks on the tab and lists them under their section", async () => {
    await withTasks(
      task({ title: "milk" }),
      task({ title: "compare prices" }),
      task({ title: "eggs", doneAt: Date.now() }),
    );

    const tab = await screen.findByRole("tab", { name: "Tasks, 2 open" });
    tab.click();

    const panel = await screen.findByRole("tabpanel", { name: "Tasks" });
    expect(within(panel).getByRole("checkbox", { name: "milk" })).toBeTruthy();
    expect(within(panel).getByText("Someday")).toBeTruthy();
    // Finished tasks wait behind the Done toggle.
    expect(within(panel).queryByRole("checkbox", { name: "eggs" })).toBeNull();
    expect(within(panel).getByRole("button", { name: /Done/ })).toBeTruthy();
    // Search and the colour filter belong to the Notes tab.
    expect(screen.queryByRole("button", { name: "Search notes" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Filter by colour" })).toBeNull();
  });

  it("adds a task without asking which note it belongs to", async () => {
    await withTasks();
    await useNotesStore.getState().setView("todo");

    const field = await screen.findByLabelText("Add a task");
    fireEvent.change(field, { target: { value: "renew passport" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => {
      expect(commandCalls("tasks_create")).toEqual([
        {
          patch: {
            title: "renew passport",
            priority: null,
            dueDate: null,
            dueTime: null,
            repeat: null,
          },
        },
      ]);
    });
    // The field empties and keeps focus, so a list can be typed in one go.
    await waitFor(() => {
      expect((field as HTMLInputElement).value).toBe("");
    });
    expect(commandCalls("notes_update")).toEqual([]);
  });

  it("reads the old tokens as details when they are typed into the field", async () => {
    await withTasks();
    await useNotesStore.getState().setView("todo");

    const field = await screen.findByLabelText("Add a task");
    fireEvent.change(field, { target: { value: "call the bank !high @2026-09-20 14:00" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => {
      expect(commandCalls("tasks_create")).toEqual([
        {
          patch: {
            title: "call the bank",
            priority: "high",
            dueDate: "2026-09-20",
            dueTime: "14:00",
            repeat: null,
          },
        },
      ]);
    });
  });

  it("ticks a task and keeps it in place until the tab is left", async () => {
    await withTasks(task({ id: "milk", title: "milk" }));
    await useNotesStore.getState().setView("todo");

    const milk = await screen.findByRole("checkbox", { name: "milk" });
    milk.click();

    await waitFor(() => {
      expect(commandCalls("tasks_set_done")).toEqual([{ id: "milk", done: true }]);
    });
    const still = screen.getByRole("checkbox", { name: "milk" });
    expect(still.getAttribute("aria-checked")).toBe("true");

    // Coming back is a new visit, and by then it has settled into Done.
    await useNotesStore.getState().setView("notes");
    await useNotesStore.getState().setView("todo");
    await waitFor(() => {
      expect(screen.queryByRole("checkbox", { name: "milk" })).toBeNull();
    });
  });

  it("never writes a note when a task changes", async () => {
    await withTasks(task({ id: "milk", title: "milk" }));
    await useNotesStore.getState().setView("todo");

    (await screen.findByRole("checkbox", { name: "milk" })).click();

    await waitFor(() => {
      expect(commandCalls("tasks_set_done")).toHaveLength(1);
    });
    expect(commandCalls("notes_update")).toEqual([]);
  });

  it("closes the details sheet on Esc before clearing the draft", async () => {
    await withTasks(task({ id: "milk", title: "milk" }));
    await useNotesStore.getState().setView("todo");
    useTasksStore.setState({ draft: "half typed" });

    (await screen.findByRole("button", { name: /milk/ })).click();
    await waitFor(() => {
      expect(useTasksStore.getState().detailsId).toBe("milk");
    });

    press("Escape");
    await waitFor(() => {
      expect(useTasksStore.getState().detailsId).toBeNull();
    });
    expect(useTasksStore.getState().draft).toBe("half typed");

    press("Escape");
    await waitFor(() => {
      expect(useTasksStore.getState().draft).toBe("");
    });
  });

  it("closes the editor when switching to Tasks", async () => {
    await withTasks();
    useNotesStore.getState().startEditing("1");
    await useNotesStore.getState().setView("todo");
    expect(useNotesStore.getState().editingId).toBeNull();
  });

  it("goes back to Notes for Cmd+F", async () => {
    await withTasks();
    await useNotesStore.getState().setView("todo");

    press("f", { metaKey: true });

    await screen.findByLabelText("Search notes");
    expect(useNotesStore.getState().view).toBe("notes");
  });

  it("offers an undo after a task is deleted", async () => {
    await withTasks(task({ id: "milk", title: "milk" }));
    await useNotesStore.getState().setView("todo");

    (await screen.findByRole("button", { name: /milk/ })).click();
    (await screen.findByRole("button", { name: "Delete task" })).click();

    await screen.findByText("Task deleted");
    expect(commandCalls("tasks_delete")).toEqual([{ id: "milk" }]);
    // Brief 6.3: the toast holds the panel open while it is there to be used.
    await waitFor(() => {
      expect(useDockStore.getState().locks.has("undo")).toBe(true);
    });
  });
});

describe("sliding between Notes and Tasks", () => {
  /** The Notes pane and the To-Do pane, children of the sliding track. */
  function panes(): HTMLElement[] {
    const track = document.querySelector('[class*="track"]');
    return Array.from(track?.children ?? []) as HTMLElement[];
  }

  it("moves the track and the tab highlight, and hides the pane that slid away", async () => {
    await renderPanel();
    const tablist = screen.getByRole("tablist", { name: "Panel view" });
    expect(tablist.style.getPropertyValue("--tab-index")).toBe("0");

    let [notesPane, todoPane] = panes();
    expect(notesPane?.getAttribute("aria-hidden")).toBe("false");
    expect(todoPane?.hasAttribute("inert")).toBe(true);
    expect(notesPane?.parentElement?.className).not.toContain("trackTodo");

    screen.getByRole("tab", { name: "Tasks" }).click();

    await waitFor(() => {
      expect(tablist.style.getPropertyValue("--tab-index")).toBe("1");
    });
    [notesPane, todoPane] = panes();
    expect(notesPane?.parentElement?.className).toContain("trackTodo");
    expect(notesPane?.getAttribute("aria-hidden")).toBe("true");
    expect(notesPane?.hasAttribute("inert")).toBe(true);
    expect(todoPane?.hasAttribute("inert")).toBe(false);
    // The hidden Notes cards are out of the accessibility tree.
    expect(screen.queryByRole("button", { name: "Standup notes" })).toBeNull();
  });

  it("keeps arrow keys away from the cards while Tasks is showing", async () => {
    await renderPanel();
    await useNotesStore.getState().setView("todo");

    const arrow = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    window.dispatchEvent(arrow);

    expect(arrow.defaultPrevented).toBe(false);
    expect(document.activeElement?.hasAttribute("data-card")).toBe(false);
  });
});

describe("task details", () => {
  // Mon 14 Sep 2026, 13:30 local: fake timers would also stall the store's
  // debounces, so only the clock is pinned.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 14, 13, 30));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function tasksWith(...tasks: Task[]) {
    tasksInDb = tasks;
    await renderPanel();
    await useNotesStore.getState().setView("todo");
    return screen.findByRole("tabpanel", { name: "Tasks" });
  }

  it("sorts tasks into date sections, highest priority first", async () => {
    const panel = await tasksWith(
      task({ title: "late", dueDate: "2026-09-01" }),
      task({ title: "soon", dueDate: "2026-09-20" }),
      task({ title: "now", dueDate: "2026-09-14" }),
      task({ title: "urgent", dueDate: "2026-09-14", priority: "high" }),
      task({ title: "whenever" }),
    );

    const headings = within(panel)
      .getAllByRole("heading")
      .map((heading) => heading.textContent);
    expect(headings).toEqual(["Overdue1", "Today2", "Upcoming1", "Someday1"]);

    // Within a section, priority comes before everything else.
    const today = panel.querySelectorAll("section")[1];
    const titles = Array.from(today?.querySelectorAll("[data-task-row]") ?? []).map((row) =>
      row.textContent?.replace("Today", ""),
    );
    expect(titles).toEqual(["urgent", "now"]);
  });

  it("sets priority, date and repeat from the details sheet", async () => {
    const panel = await tasksWith(task({ id: "plants", title: "water plants" }));
    within(panel).getByRole("button", { name: /water plants/ }).click();

    (await within(panel).findByRole("button", { name: "High" })).click();
    await waitFor(() => {
      expect(commandCalls("tasks_update")).toContainEqual({
        id: "plants",
        patch: { priority: "high" },
      });
    });

    within(panel).getByRole("button", { name: "Tomorrow" }).click();
    await waitFor(() => {
      expect(commandCalls("tasks_update")).toContainEqual({
        id: "plants",
        patch: { dueDate: "2026-09-15" },
      });
    });

    within(panel).getByRole("button", { name: "Daily" }).click();
    await waitFor(() => {
      expect(commandCalls("tasks_update")).toContainEqual({
        id: "plants",
        patch: { repeat: "daily" },
      });
    });
  });

  it("clears the date and the repeat together: a time with no day is not a when", async () => {
    const panel = await tasksWith(
      task({ id: "plants", title: "water plants", dueDate: "2026-09-15", repeat: "daily" }),
    );
    within(panel).getByRole("button", { name: /water plants/ }).click();

    (await within(panel).findByRole("button", { name: "Clear due date and repeat" })).click();

    await waitFor(() => {
      expect(commandCalls("tasks_update")).toContainEqual({
        id: "plants",
        patch: { dueDate: null, repeat: null },
      });
    });
  });

  it("renames a task when its title field is left", async () => {
    const panel = await tasksWith(task({ id: "plants", title: "water plants" }));
    within(panel).getByRole("button", { name: /water plants/ }).click();

    const field = await within(panel).findByLabelText("Task");
    fireEvent.change(field, { target: { value: "water the plants" } });
    fireEvent.blur(field);

    await waitFor(() => {
      expect(commandCalls("tasks_update")).toContainEqual({
        id: "plants",
        patch: { title: "water the plants" },
      });
    });
  });

  it("does not write a title that has not changed", async () => {
    const panel = await tasksWith(task({ id: "plants", title: "water plants" }));
    within(panel).getByRole("button", { name: /water plants/ }).click();

    const field = await within(panel).findByLabelText("Task");
    fireEvent.focus(field);
    fireEvent.blur(field);

    expect(commandCalls("tasks_update")).toEqual([]);
  });

  it("keeps a notes field for what the title has no room for", async () => {
    const panel = await tasksWith(task({ id: "plants", title: "water plants" }));
    within(panel).getByRole("button", { name: /water plants/ }).click();

    const field = await within(panel).findByLabelText("Task notes");
    fireEvent.change(field, { target: { value: "the ones on the balcony" } });
    fireEvent.blur(field);

    await waitFor(() => {
      expect(commandCalls("tasks_update")).toContainEqual({
        id: "plants",
        patch: { notes: "the ones on the balcony" },
      });
    });
  });

  /** Repeating means it comes back, not that it is ever finished. */
  it("moves a repeating task to its next date instead of completing it", async () => {
    const panel = await tasksWith(
      task({ id: "plants", title: "water plants", dueDate: "2026-09-14", repeat: "daily" }),
    );

    (await within(panel).findByRole("checkbox", { name: "water plants" })).click();

    await waitFor(() => {
      expect(commandCalls("tasks_update")).toContainEqual({
        id: "plants",
        patch: { dueDate: "2026-09-15", dueTime: null },
      });
    });
    expect(commandCalls("tasks_set_done")).toEqual([]);
  });

  it("shows the details that matter at a glance on the row", async () => {
    const panel = await tasksWith(
      task({
        title: "water plants",
        dueDate: "2026-09-15",
        repeat: "daily",
        priority: "high",
        notes: "balcony",
      }),
    );

    const row = within(panel).getByRole("checkbox", { name: "water plants" }).closest("li");
    expect(row?.textContent).toContain("Tomorrow");
    expect(within(row as HTMLElement).getByLabelText("high priority")).toBeTruthy();
    expect(within(row as HTMLElement).getByLabelText("Repeats")).toBeTruthy();
    expect(within(row as HTMLElement).getByLabelText("Has notes")).toBeTruthy();
    expect(row?.textContent).not.toContain("repeat:");
  });
});

describe("reminders", () => {
  it("sends Rust the reminders for open dated tasks once they settle", async () => {
    tasksInDb = [
      task({ title: "pay rent", dueDate: "2026-10-01" }),
      task({ title: "no date" }),
    ];
    await renderPanel();

    await waitFor(
      () => {
        const sent = commandCalls("reminders_set").at(-1) as { list: { title: string }[] } | undefined;
        expect(sent?.list.map((reminder) => reminder.title)).toEqual(["pay rent"]);
      },
      { timeout: 3_000 },
    );
  });
});
