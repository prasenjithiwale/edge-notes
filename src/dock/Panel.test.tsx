// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { ArchivedItem, Note, SecurityStatus, Settings, Task } from "../lib/ipc";
import { idle as pomodoroIdle } from "../lib/pomodoro";

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
const { useArchiveStore } = await import("../store/archive");
const { usePomodoroStore } = await import("../store/pomodoro");
const { useSettingsStore } = await import("../store/settings");

function note(overrides: Partial<Note> & { id: string }): Note {
  return {
    content: "",
    color: "yellow",
    pinned: false,
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
    sortOrder: null,
    ...overrides,
  };
}

const NOTES: Note[] = [
  note({ id: "1", content: "Standup notes\nDeploy the fix", color: "pink", updatedAt: 30 }),
  note({ id: "2", content: "Groceries\nMilk and coffee", color: "blue", updatedAt: 20 }),
  note({ id: "3", content: "Book flights", color: "mint", updatedAt: 10 }),
];

let archivedInDb: ArchivedItem[] = [];

let madeTask = 0;
function task(overrides: Partial<Task> = {}): Task {
  madeTask += 1;
  return {
    id: `task-${String(madeTask)}`,
    title: `task ${String(madeTask)}`,
    notes: "",
    // A stored task always has both, and Rust keeps them in step: a task with a
    // time on it closed. Derived here so a fixture can say either.
    status: overrides.doneAt == null ? "open" : "done",
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
  "tab.size": "medium",
  "panel.width": 320,
  theme: "system",
  "notes.lastColor": "yellow",
  "notes.lastCodeLang": "",
  "appearance.accent": "none",
  "notes.manualOrder": false,
  "shortcut.newNote": "CmdOrCtrl+Alt+N",
  "shortcut.quickCapture": "CmdOrCtrl+Alt+Space",
  "shortcut.clipboardNote": "CmdOrCtrl+Alt+V",
  "tasks.reminders": true,
  "privacy.hideFromCapture": true,
  "panel.translucency": 0,
  "focus.focusMinutes": 25,
  "focus.breakMinutes": 5,
  "focus.longBreakMinutes": 15,
  "focus.longBreakEvery": 4,
  "focus.autoStart": false,
  "focus.taskId": "",
  "focus.day": "",
  "focus.today": 0,
  "focus.streak": 0,
  "focus.log": [],
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

/** What Rust would hand back, so a test can store a setting before the render. */
let settingsInDb: Settings = SETTINGS;
/** How protected the database is, for the locked-panel test. */
let securityInDb: SecurityStatus = {
  captureProtection: true,
  protection: "on",
  detail: "",
};

beforeEach(() => {
  settingsInDb = SETTINGS;
  securityInDb = { captureProtection: true, protection: "on", detail: "" };
  // The settings store is a module singleton: left loaded from the last test, the
  // panel would hydrate the Focus tab from that test's values before this one's
  // settings_get resolved.
  useSettingsStore.setState({ settings: SETTINGS, loaded: false });
  invoke.mockReset();
  invoke.mockImplementation((command: string, args?: unknown) => {
    if (command === "notes_list") {
      return Promise.resolve(NOTES);
    }
    if (command === "settings_get") {
      return Promise.resolve(settingsInDb);
    }
    if (command === "security_status") {
      return Promise.resolve(securityInDb);
    }
    if (command === "settings_update") {
      const { patch } = args as { patch: Partial<Settings> };
      settingsInDb = { ...settingsInDb, ...patch };
      return Promise.resolve(settingsInDb);
    }
    if (command === "notes_create") {
      return Promise.resolve(note({ id: "new", color: "yellow", updatedAt: 40 }));
    }
    if (command === "monitors_list") {
      return Promise.resolve([]);
    }
    if (command === "tasks_list") {
      return Promise.resolve(tasksInDb);
    }
    if (command === "clips_list") {
      return Promise.resolve([]);
    }
    if (command === "archive_list") {
      return Promise.resolve(archivedInDb);
    }
    if (command === "archive_purge") {
      const { id } = args as { id: string };
      archivedInDb = archivedInDb.filter((entry) => entry.id !== id);
      return Promise.resolve(null);
    }
    if (command === "notes_restore" || command === "tasks_restore") {
      const { id } = args as { id: string };
      archivedInDb = archivedInDb.filter((entry) => entry.id !== id);
      return Promise.resolve(
        command === "notes_restore" ? note({ id, content: "Book flights" }) : task({ id }),
      );
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
    if (command === "tasks_set_status") {
      const { id, status } = args as { id: string; status: Task["status"] };
      const found = tasksInDb.find((entry) => entry.id === id) ?? task();
      const closed = status === "done" || status === "cancelled";
      // As Rust does: the time it closed. A fixed old timestamp would put the
      // task outside the day-long window the closed sections show.
      const updated = { ...found, status, doneAt: closed ? Date.now() : null };
      tasksInDb = tasksInDb.map((entry) => (entry.id === id ? updated : entry));
      return Promise.resolve(updated);
    }
    return Promise.resolve(null);
  });
  useDockStore.setState({ locks: new Set(), large: false, panelWidth: 320 });
  tasksInDb = [];
  archivedInDb = [];
  useArchiveStore.setState({ items: [], loaded: false, restoringId: null });
  usePomodoroStore.setState({
    state: pomodoroIdle(),
    autoStart: false,
    taskId: null,
    hydrated: false,
  });
  useTasksStore.setState({
    tasks: [],
    loaded: false,
    draft: "",
    editingId: null,
    detailsId: null,
    // What the store starts with: both closed sections folded.
    collapsed: new Set(["done", "cancelled"]),
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
        quick: false,
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

/** Open the editor on note 1 with some text already in it. */
async function openEditorWith(content: string) {
  await renderPanel();
  useNotesStore.getState().setContent("1", content);
  useNotesStore.getState().startEditing("1");
  return screen.findByLabelText("Note content");
}

/**
 * The editor is rich text now, so what is checked here is what is on screen and
 * what reaches the store. The commands themselves — what ⌘B does to a selection,
 * what each list button produces — are in `notes/editor/toolbar.test.ts`, where
 * a headless editor can be given a real selection.
 */
describe("the note editor", () => {
  it("shows the formatting rather than the markers", async () => {
    const field = await openEditorWith("**Standup** and _soft_ and `x`");

    // The point of the whole change: nobody has to read or type `**`.
    expect(field.textContent).toBe("Standup and soft and x");
    expect(field.querySelector("strong")?.textContent).toBe("Standup");
    expect(field.querySelector("em")?.textContent).toBe("soft");
    expect(field.querySelector("code")?.textContent).toBe("x");
  });

  it("draws a list as a list", async () => {
    const field = await openEditorWith("Shopping\n- milk\n- eggs");

    expect(field.querySelectorAll("ul li")).toHaveLength(2);
    expect(field.textContent).not.toContain("- milk");
  });

  /**
   * The header carries the note's own actions and nothing else. Formatting used
   * to fill it; it is on the keys and in the slash menu now, and eight more
   * icons on a 320 px card crowded out the one control that is about the window.
   */
  it("keeps only the note's own actions in the header", async () => {
    const field = await openEditorWith("Standup notes");
    // Scoped to the editor: the other cards in the list have their own Expand.
    const editor = within(field.closest("section") as HTMLElement);

    for (const name of ["Expand note", "Lock note", "Delete note", "Done"]) {
      expect(editor.getByRole("button", { name })).toBeTruthy();
    }
    for (const gone of ["Bold", "Italic", "Strikethrough", "Bulleted list", "Code block"]) {
      expect(editor.queryByRole("button", { name: gone })).toBeNull();
    }
  });

  it("finishes with the tick rather than a word", async () => {
    const field = await openEditorWith("Standup notes");
    const editor = within(field.closest("section") as HTMLElement);

    fireEvent.click(editor.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(useNotesStore.getState().editingId).toBeNull();
    });
  });

  it("still says when the note was last written", async () => {
    await openEditorWith("Standup notes");
    expect(screen.getByText(/Edited|just now/)).toBeTruthy();
  });
});

describe("a code block in the editor", () => {
  it("is a text box with a language dropdown, not a wall of choices", async () => {
    await openEditorWith("```python\nname = 1\n```");

    const chooser = await screen.findByLabelText<HTMLSelectElement>("Code language");
    expect(chooser.value).toBe("python");
    // Every language is in the one control rather than laid out beforehand.
    expect(chooser.querySelectorAll("option").length).toBeGreaterThan(10);

    const code = screen.getByLabelText<HTMLTextAreaElement>("Code, Python");
    expect(code.value).toBe("name = 1");
  });

  it("writes what is typed in the box back to the note", async () => {
    await openEditorWith("```python\nname = 1\n```");
    const code = await screen.findByLabelText("Code, Python");

    fireEvent.change(code, { target: { value: "name = 2" } });

    await waitFor(() => {
      expect(contentOf("1")).toBe("```python\nname = 2\n```");
    });
  });

  it("changes the language from the dropdown, and remembers it", async () => {
    await openEditorWith("```python\nname = 1\n```");

    fireEvent.change(await screen.findByLabelText("Code language"), {
      target: { value: "json" },
    });

    await waitFor(() => {
      expect(contentOf("1")).toBe("```json\nname = 1\n```");
    });
    await waitFor(() => {
      const patches = commandCalls("settings_update") as { patch: Record<string, unknown> }[];
      expect(patches.some((call) => call.patch["notes.lastCodeLang"] === "json")).toBe(true);
    });
  });

  it("can be removed from the block itself", async () => {
    await openEditorWith("before\n```js\nconst a = 1\n```");

    fireEvent.click(await screen.findByRole("button", { name: "Remove code block" }));

    await waitFor(() => {
      expect(contentOf("1")).toBe("before");
    });
  });
});

describe("checkboxes on a card", () => {
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
    await screen.findByLabelText("Note content");
    // What typing does: the editor serialises itself into the store on every
    // change. Driving a contenteditable keystroke by keystroke in jsdom tests
    // the test harness, not the panel.
    useNotesStore.getState().setContent("1", "Standup notes\nDeploy the fix today");

    clickOn(screen.getByRole("button", { name: "Keep open" }));

    await Promise.resolve();
    expect(useNotesStore.getState().editingId).toBe("1");
  });

  it("ignores clicks inside the note, and a selection dragged out of it", async () => {
    await renderPanel();
    useNotesStore.getState().startEditing("1");
    const field = await screen.findByLabelText("Note content");

    clickOn(screen.getByRole("button", { name: "Lock note" }));
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
    // Sixteen colours and the way to have none of them.
    expect(grid.querySelectorAll("button")).toHaveLength(17);

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

describe("the archive", () => {
  /**
   * The owner's report, 18 Sep 2026: a deleted note showed an undo toast for a
   * few seconds and then could not be found at all. It was never gone — soft
   * deletes are kept for thirty days — but nothing could see it, so the toast
   * expiring looked like the note being destroyed.
   */
  it("is not clickable while nothing has been deleted", async () => {
    await renderPanel();

    const button = await screen.findByRole("button", { name: "Archive, empty" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    // Pressing it opens nothing, which is the point of it being off.
    button.click();
    expect(screen.queryByRole("region", { name: "Archive" })).toBeNull();
  });

  it("lists what has been deleted, newest first, and says how long it is kept", async () => {
    archivedInDb = [
      {
        id: "3",
        kind: "note",
        text: "Book flights\nAisle seat",
        color: "mint",
        deletedAt: Date.now() - (2 * 60 + 5) * 60 * 1000,
        purgeAt: Date.now() + 28 * 24 * 60 * 60 * 1000 - 60_000,
      },
      {
        id: "milk",
        kind: "task",
        text: "milk",
        color: null,
        deletedAt: Date.now() - (3 * 24 + 1) * 60 * 60 * 1000,
        purgeAt: Date.now() + 27 * 24 * 60 * 60 * 1000,
      },
    ];
    await renderPanel();

    const button = await screen.findByRole("button", { name: "Archive, 2 deleted" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    button.click();

    const archive = await screen.findByRole("region", { name: "Archive" });
    const rows = within(archive).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    // Newest first is the order the command returns; the view does not re-sort.
    expect(rows[0]?.textContent).toContain("Book flights");
    expect(rows[0]?.textContent).toContain("2 hours ago");
    expect(rows[1]?.textContent).toContain("3 days ago");
    // What it costs to wait: the day it goes for good.
    expect(rows[0]?.textContent).toContain("Kept for 28 more days");
  });

  it("puts a note back and drops it from the list", async () => {
    archivedInDb = [
      {
        id: "3",
        kind: "note",
        text: "Book flights",
        color: "mint",
        deletedAt: Date.now() - 60_000,
        purgeAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      },
    ];
    await renderPanel();
    (await screen.findByRole("button", { name: "Archive, 1 deleted" })).click();

    (await screen.findByRole("button", { name: "Restore Book flights" })).click();

    await waitFor(() => {
      expect(commandCalls("notes_restore")).toEqual([{ id: "3" }]);
    });
    // The notes list is read again, so the note lands where its own timestamp
    // puts it rather than at the top.
    await waitFor(() => {
      expect(commandCalls("notes_list").length).toBeGreaterThan(1);
    });
    // The row has gone, and the screen says why it is empty rather than showing
    // a list of nothing.
    await screen.findByText("Nothing deleted");
    // And on the way out, the door has closed behind you.
    (await screen.findByRole("button", { name: "Back to notes" })).click();
    await waitFor(() => {
      const button = screen.getByRole("button", { name: "Archive, empty" });
      expect((button as HTMLButtonElement).disabled).toBe(true);
    });
  });

  /**
   * The only irreversible thing in the app, so the only one that asks first:
   * everything else answers a mistake with an undo, and there is nothing behind
   * this one.
   */
  it("asks before deleting something for good, and does nothing until told twice", async () => {
    archivedInDb = [
      {
        id: "3",
        kind: "note",
        text: "Book flights",
        color: "mint",
        deletedAt: Date.now() - 60_000,
        purgeAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      },
    ];
    await renderPanel();
    (await screen.findByRole("button", { name: "Archive, 1 deleted" })).click();

    (await screen.findByRole("button", { name: "Delete Book flights permanently" })).click();
    // Armed, and nothing sent.
    expect(commandCalls("archive_purge")).toEqual([]);

    // Backing out leaves the row alone.
    (await screen.findByRole("button", { name: "Keep" })).click();
    await screen.findByRole("button", { name: "Restore Book flights" });
    expect(commandCalls("archive_purge")).toEqual([]);

    (await screen.findByRole("button", { name: "Delete Book flights permanently" })).click();
    (await screen.findByRole("button", { name: "Delete Book flights for good" })).click();

    await waitFor(() => {
      expect(commandCalls("archive_purge")).toEqual([{ id: "3", kind: "note" }]);
    });
    // It is gone from the list, and there is nothing left to restore.
    await screen.findByText("Nothing deleted");
  });

  it("closes on Esc, like the settings pane it sits beside", async () => {
    archivedInDb = [
      {
        id: "3",
        kind: "note",
        text: "Book flights",
        color: "mint",
        deletedAt: Date.now() - 60_000,
        purgeAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      },
    ];
    await renderPanel();
    (await screen.findByRole("button", { name: "Archive, 1 deleted" })).click();
    await screen.findByRole("region", { name: "Archive" });

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "Archive" })).toBeNull();
    });
    // And the panel is still open: Esc closed the front-most thing, not both.
    expect(useDockStore.getState().phase).not.toBe("collapsed");
  });
});

describe("the Tasks tab", () => {
  /** Today, as the store writes it: these tests run against the real clock. */
  function todayKey(): string {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

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

  /**
   * A status chosen in the sheet takes effect in the list at once.
   *
   * Reported by the owner on 18 Sep 2026: the row held its old section until the
   * tab was left and come back to, so the list went on saying "In progress"
   * about a task the sheet open inside it said was cancelled. Only a tick holds
   * a row now — that is a press protecting itself from its own consequences;
   * this is an answer, and an answer that is ignored looks broken.
   */
  it("moves a row as soon as its status is chosen in the sheet", async () => {
    await withTasks(task({ id: "draft", title: "draft the email", dueDate: todayKey() }));
    await useNotesStore.getState().setView("todo");

    (await screen.findByRole("button", { name: /draft the email/ })).click();
    (await screen.findByRole("button", { name: "In progress" })).click();

    await waitFor(() => {
      expect(commandCalls("tasks_set_status")).toEqual([
        { id: "draft", status: "in_progress" },
      ]);
    });

    const panel = screen.getByRole("tabpanel", { name: "Tasks" });
    // The headings carry their count, which is what tells them from the sheet's
    // own "Today" chip and its "In progress" segment.
    await waitFor(() => {
      expect(
        within(panel).getAllByRole("button", { name: "In progress1" }).length,
      ).toBeGreaterThan(0);
    });
    expect(within(panel).queryByRole("button", { name: "Today1" })).toBeNull();
    // The box says so too, in the three-state way a box says it.
    expect(
      within(panel).getByRole("checkbox", { name: "draft the email" }).getAttribute(
        "aria-checked",
      ),
    ).toBe("mixed");
    // And the sheet went with it rather than being left behind.
    expect(within(panel).getByRole("textbox", { name: "Task" })).toBeTruthy();
  });

  /** The same, for the status the owner reported it with. */
  it("moves a row out of In progress the moment it is cancelled", async () => {
    await withTasks(
      task({ id: "venue", title: "book the venue", status: "in_progress" }),
      task({ id: "other", title: "call the printer", dueDate: todayKey() }),
    );
    await useNotesStore.getState().setView("todo");

    (await screen.findByRole("button", { name: /book the venue/ })).click();
    (await screen.findByRole("button", { name: "Cancelled" })).click();

    await waitFor(() => {
      expect(commandCalls("tasks_set_status")).toEqual([
        { id: "venue", status: "cancelled" },
      ]);
    });

    const panel = screen.getByRole("tabpanel", { name: "Tasks" });
    // In progress is empty now, so the section is gone; Cancelled has it, folded
    // as it starts, with the count as the answer.
    await waitFor(() => {
      expect(within(panel).queryByRole("button", { name: "In progress1" })).toBeNull();
    });
    expect(within(panel).getByRole("button", { name: "Cancelled1" })).toBeTruthy();
    expect(within(panel).queryByRole("checkbox", { name: /book the venue/ })).toBeNull();
  });

  /**
   * The box is the other half of the rule: ticking one must not throw the row
   * into Done from under the finger that ticked it.
   */
  it("keeps a ticked row where it was until the tab is left", async () => {
    await withTasks(task({ id: "milk", title: "milk", dueDate: todayKey() }));
    await useNotesStore.getState().setView("todo");

    (await screen.findByRole("checkbox", { name: "milk" })).click();

    await waitFor(() => {
      expect(commandCalls("tasks_set_status")).toEqual([{ id: "milk", status: "done" }]);
    });
    const panel = screen.getByRole("tabpanel", { name: "Tasks" });
    expect(within(panel).getAllByRole("button", { name: "Today1" }).length).toBeGreaterThan(
      0,
    );

    // Coming back is a new visit, and by then it has settled into Done.
    await useNotesStore.getState().setView("notes");
    await useNotesStore.getState().setView("todo");
    await waitFor(() => {
      expect(screen.queryByRole("checkbox", { name: "milk" })).toBeNull();
    });
  });

  it("cancels a task, which closes it without counting it as finished", async () => {
    await withTasks(task({ id: "venue", title: "book the venue" }));
    await useNotesStore.getState().setView("todo");

    (await screen.findByRole("button", { name: /book the venue/ })).click();
    (await screen.findByRole("button", { name: "Cancelled" })).click();

    await waitFor(() => {
      expect(commandCalls("tasks_set_status")).toEqual([
        { id: "venue", status: "cancelled" },
      ]);
    });

    // Cancelled starts folded, as Done does; unfolding it is where the task went.
    const panel = screen.getByRole("tabpanel", { name: "Tasks" });
    (await within(panel).findByRole("button", { name: "Cancelled1" })).click();

    // The box is not a tick: a cancelled task was not done, and says which.
    const box = await within(panel).findByRole("checkbox", {
      name: "book the venue (cancelled)",
    });
    expect(box.getAttribute("aria-checked")).toBe("false");
    // And the tab stops counting it as work.
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Tasks" })).toBeTruthy();
    });
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
      expect(commandCalls("tasks_set_status")).toEqual([{ id: "milk", status: "done" }]);
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

  /**
   * Reported by the owner: a task marked done could not be undone. A row held
   * in place is grouped from a copy with its `doneAt` cleared, so that it is
   * listed among the open tasks rather than jumping to Done under the cursor —
   * and the box was reading its own state from that copy. It answered "still
   * open" however the press went, so the tick never came off and the next press
   * read as another tick.
   */
  it("unticks a task it has just ticked", async () => {
    await withTasks(task({ id: "milk", title: "milk" }));
    await useNotesStore.getState().setView("todo");

    const box = () => screen.getByRole("checkbox", { name: "milk" });
    (await screen.findByRole("checkbox", { name: "milk" })).click();
    await waitFor(() => {
      expect(box().getAttribute("aria-checked")).toBe("true");
    });

    box().click();
    await waitFor(() => {
      expect(commandCalls("tasks_set_status")).toEqual([
        { id: "milk", status: "done" },
        { id: "milk", status: "open" },
      ]);
    });
    // And it reads as open again, rather than as a tick that will not come off.
    await waitFor(() => {
      expect(box().getAttribute("aria-checked")).toBe("false");
    });
  });

  it("never writes a note when a task changes", async () => {
    await withTasks(task({ id: "milk", title: "milk" }));
    await useNotesStore.getState().setView("todo");

    (await screen.findByRole("checkbox", { name: "milk" })).click();

    await waitFor(() => {
      expect(commandCalls("tasks_set_status")).toHaveLength(1);
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

  /**
   * Search used to mean "search the notes", and pressing Cmd+F on the Tasks tab
   * threw you back to a list you were not looking at. It searches whatever is in
   * front of you now.
   */
  it("searches the tasks with Cmd+F, without leaving the tab", async () => {
    await withTasks(task({ id: "milk", title: "buy milk" }), task({ id: "tax", title: "file tax" }));
    await useNotesStore.getState().setView("todo");

    press("f", { metaKey: true });

    // By role, not by label: the header's search *button* carries the same name
    // until React has swapped it for the field.
    const field = await screen.findByRole("textbox", { name: "Search tasks" });
    expect(useNotesStore.getState().view).toBe("todo");

    fireEvent.change(field, { target: { value: "milk" } });
    await screen.findByRole("checkbox", { name: "buy milk" });
    await waitFor(() => {
      expect(screen.queryByRole("checkbox", { name: "file tax" })).toBeNull();
    });
  });

  it("says so when a search matches no task", async () => {
    await withTasks(task({ id: "milk", title: "buy milk" }));
    await useNotesStore.getState().setView("todo");

    press("f", { metaKey: true });
    fireEvent.change(await screen.findByRole("textbox", { name: "Search tasks" }), {
      target: { value: "zebra" },
    });

    await screen.findByText(/No tasks match/);
  });

  /** The Focus tab is not a list, so there is nothing there to search. */
  it("leaves Cmd+F alone on the Focus tab", async () => {
    await withTasks();
    await useNotesStore.getState().setView("focus");

    press("f", { metaKey: true });

    expect(useNotesStore.getState().searching).toBe(false);
    expect(useNotesStore.getState().view).toBe("focus");
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

describe("sliding between the tabs", () => {
  /** The three panes, children of the sliding track. */
  function panes(): HTMLElement[] {
    const track = document.querySelector('[class*="track"]');
    return Array.from(track?.children ?? []) as HTMLElement[];
  }

  function track(): HTMLElement | null {
    return document.querySelector('[class*="track"]');
  }

  it("moves the track and the tab highlight, and hides the panes that slid away", async () => {
    await renderPanel();
    const tablist = screen.getByRole("tablist", { name: "Panel view" });
    expect(tablist.style.getPropertyValue("--tab-index")).toBe("0");
    // Four tabs, so the track is four panels wide and shifts by a quarter.
    expect(track()?.style.width).toBe("400%");
    expect(track()?.style.transform).toBe("translateX(-0%)");

    let [notesPane, todoPane, focusPane] = panes();
    expect(notesPane?.getAttribute("aria-hidden")).toBe("false");
    expect(todoPane?.hasAttribute("inert")).toBe(true);
    expect(focusPane?.hasAttribute("inert")).toBe(true);

    screen.getByRole("tab", { name: "Tasks" }).click();

    await waitFor(() => {
      expect(tablist.style.getPropertyValue("--tab-index")).toBe("1");
    });
    expect(track()?.style.transform).toBe("translateX(-25%)");
    [notesPane, todoPane, focusPane] = panes();
    expect(notesPane?.getAttribute("aria-hidden")).toBe("true");
    expect(notesPane?.hasAttribute("inert")).toBe(true);
    expect(todoPane?.hasAttribute("inert")).toBe(false);
    expect(focusPane?.hasAttribute("inert")).toBe(true);
    // The hidden Notes cards are out of the accessibility tree.
    expect(screen.queryByRole("button", { name: "Standup notes" })).toBeNull();

    screen.getByRole("tab", { name: "Focus" }).click();
    await waitFor(() => {
      expect(tablist.style.getPropertyValue("--tab-index")).toBe("2");
    });
    expect(panes()[2]?.hasAttribute("inert")).toBe(false);
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
    expect(commandCalls("tasks_set_status")).toEqual([]);
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
    expect(within(row as HTMLElement).getByLabelText("Repeats Daily")).toBeTruthy();
    expect(within(row as HTMLElement).getByLabelText("Has notes")).toBeTruthy();
    expect(row?.textContent).not.toContain("repeat:");
  });
});

describe("the panel toolbar", () => {
  it("keeps Settings and Keep open at the foot of the panel, on every tab", async () => {
    await renderPanel();

    const toolbar = document.querySelector('[class*="toolbar"]');
    expect(within(toolbar as HTMLElement).getByRole("button", { name: "Settings" })).toBeTruthy();
    expect(within(toolbar as HTMLElement).getByRole("button", { name: "Keep open" })).toBeTruthy();
    // And not in the header any more.
    const header = document.querySelector("header");
    expect(within(header as HTMLElement).queryByRole("button", { name: "Settings" })).toBeNull();

    await useNotesStore.getState().setView("focus");
    expect(within(toolbar as HTMLElement).getByRole("button", { name: "Keep open" })).toBeTruthy();
  });

  it("opens settings from the toolbar and comes back", async () => {
    await renderPanel();
    const toolbar = document.querySelector('[class*="toolbar"]') as HTMLElement;

    within(toolbar).getByRole("button", { name: "Settings" }).click();
    await screen.findByRole("heading", { name: "Settings" });

    within(toolbar).getByRole("button", { name: "Back" }).click();
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
    });
  });
});

describe("the Focus tab", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 16, 10, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts at a full focus session and counts down from the moment it starts", async () => {
    await renderPanel();
    await useNotesStore.getState().setView("focus");

    const panel = await screen.findByRole("tabpanel", { name: "Focus" });
    expect(within(panel).getByRole("timer").textContent).toBe("25:00");

    within(panel).getByRole("button", { name: "Start" }).click();
    await screen.findByRole("button", { name: "Pause" });

    vi.setSystemTime(new Date(2026, 8, 16, 10, 1));
    await waitFor(() => {
      expect(usePomodoroStore.getState().state.endsAt).not.toBeNull();
    });
    // The end is a moment, so a minute of wall clock is a minute off the clock
    // whether or not anything was running to notice.
    const endsAt = usePomodoroStore.getState().state.endsAt ?? 0;
    expect(endsAt - new Date(2026, 8, 16, 10, 1).getTime()).toBe(24 * 60_000);
  });

  it("takes a typed session length, clamped, and hides the control while running", async () => {
    await renderPanel();
    await useNotesStore.getState().setView("focus");
    const panel = await screen.findByRole("tabpanel", { name: "Focus" });

    const field = within(panel).getByRole("spinbutton", { name: "Session length in minutes" });
    fireEvent.change(field, { target: { value: "42" } });
    fireEvent.blur(field);
    await waitFor(() => {
      expect(within(panel).getByRole("timer").textContent).toBe("42:00");
    });
    expect(invoke).toHaveBeenCalledWith("settings_update", {
      patch: { "focus.focusMinutes": 42 },
    });

    fireEvent.change(field, { target: { value: "500" } });
    fireEvent.blur(field);
    await waitFor(() => {
      expect(within(panel).getByRole("timer").textContent).toBe("2:00:00");
    });

    within(panel).getByRole("button", { name: "Start" }).click();
    await screen.findByRole("button", { name: "Pause" });
    expect(within(panel).queryByRole("spinbutton")).toBeNull();
  });

  it("tells Rust when the session ends, so a closed panel still says so", async () => {
    await renderPanel();
    await useNotesStore.getState().setView("focus");
    (await screen.findByRole("button", { name: "Start" })).click();

    await waitFor(
      () => {
        const sent = commandCalls("reminders_set").at(-1) as
          | { list: { id: string; title: string }[] }
          | undefined;
        expect(sent?.list.some((reminder) => reminder.title === "Focus finished")).toBe(true);
      },
      { timeout: 3_000 },
    );
  });

  /**
   * The menu bar is the other place a collapsed widget can say something. Rust
   * is given the *moment* the phase ends, never a count: this panel's clock
   * stops while it is collapsed, and a countdown driven from it would lose
   * minutes without knowing.
   */
  it("gives the menu bar the moment the phase ends, and takes it back on pause", async () => {
    await renderPanel();
    await useNotesStore.getState().setView("focus");
    (await screen.findByRole("button", { name: "Start" })).click();

    await waitFor(() => {
      const sent = commandCalls("focus_timer_set").at(-1) as
        | { session: { endsAt: number | null } }
        | undefined;
      expect(sent?.session.endsAt).toBe(usePomodoroStore.getState().state.endsAt);
      expect(typeof sent?.session.endsAt).toBe("number");
    });

    (await screen.findByRole("button", { name: "Pause" })).click();
    await waitFor(() => {
      const sent = commandCalls("focus_timer_set").at(-1) as
        | { session: { endsAt: number | null } }
        | undefined;
      expect(sent?.session.endsAt).toBeNull();
    });
  });

  it("withdraws that reminder when the timer is paused", async () => {
    await renderPanel();
    await useNotesStore.getState().setView("focus");
    (await screen.findByRole("button", { name: "Start" })).click();
    (await screen.findByRole("button", { name: "Pause" })).click();

    await waitFor(
      () => {
        const sent = commandCalls("reminders_set").at(-1) as
          | { list: { id: string }[] }
          | undefined;
        expect(sent?.list.some((reminder) => reminder.id.startsWith("pomodoro"))).toBe(false);
      },
      { timeout: 3_000 },
    );
  });

  it("skips to a break without counting the session that was skipped", async () => {
    await renderPanel();
    await useNotesStore.getState().setView("focus");

    (await screen.findByRole("button", { name: "Skip to a break" })).click();

    await waitFor(() => {
      expect(usePomodoroStore.getState().state.phase).toBe("short");
    });
    expect(usePomodoroStore.getState().state.today).toBe(0);
    expect(screen.getByRole("timer").textContent).toBe("5:00");
  });

  /** One control with two beside it, so it gets the keys a media player would. */
  it("starts and pauses on the space bar", async () => {
    await renderPanel();
    await useNotesStore.getState().setView("focus");
    await screen.findByRole("button", { name: "Start" });

    press(" ");
    await screen.findByRole("button", { name: "Pause" });

    press(" ");
    await screen.findByRole("button", { name: "Start" });
  });

  it("runs to the length that is stored, not to twenty-five minutes", async () => {
    settingsInDb = { ...SETTINGS, "focus.focusMinutes": 50 };
    await renderPanel();
    await useNotesStore.getState().setView("focus");

    await waitFor(() => {
      expect(screen.getByRole("timer").textContent).toBe("50:00");
    });
  });

  it("reads the day's tally back from storage", async () => {
    settingsInDb = { ...SETTINGS, "focus.day": "2026-09-16", "focus.today": 3 };
    await renderPanel();
    await useNotesStore.getState().setView("focus");

    await screen.findByText("3 sessions finished today");
  });

  /**
   * The one door between the two tabs. A pomodoro with a name on it is a
   * session; one without is a kitchen timer.
   */
  it("takes a task from its details sheet and names the session after it", async () => {
    tasksInDb = [task({ id: "intro", title: "rewrite the intro" })];
    await renderPanel();
    await useNotesStore.getState().setView("todo");

    (await screen.findByRole("button", { name: /rewrite the intro/ })).click();
    (await screen.findByRole("button", { name: "Focus on this" })).click();

    await waitFor(() => {
      expect(useNotesStore.getState().view).toBe("focus");
    });
    expect(usePomodoroStore.getState().taskId).toBe("intro");
    // Scoped to the tab: the Tasks pane stays mounted behind it, with a row of
    // the same name in it.
    const focus = await screen.findByRole("tabpanel", { name: "Focus" });
    await within(focus).findByText("rewrite the intro");

    // And the notification at the end says which task it was.
    (await screen.findByRole("button", { name: "Start" })).click();
    await waitFor(
      () => {
        const sent = commandCalls("reminders_set").at(-1) as
          | { list: { body: string }[] }
          | undefined;
        expect(sent?.list.some((reminder) => reminder.body.includes("rewrite the intro"))).toBe(
          true,
        );
      },
      { timeout: 3_000 },
    );
  });

  /** A task id read back from storage must outlive an empty list at startup. */
  it("keeps the stored task while the task list is still loading", async () => {
    settingsInDb = { ...SETTINGS, "focus.taskId": "intro" };
    tasksInDb = [task({ id: "intro", title: "rewrite the intro" })];
    await renderPanel();
    await useNotesStore.getState().setView("focus");

    const focus = await screen.findByRole("tabpanel", { name: "Focus" });
    await within(focus).findByText("rewrite the intro");
    expect(usePomodoroStore.getState().taskId).toBe("intro");
  });

  it("marks the tab while a session is running", async () => {
    await renderPanel();
    await useNotesStore.getState().setView("focus");
    (await screen.findByRole("button", { name: "Start" })).click();

    await screen.findByRole("tab", { name: "Focus, running" });
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

/**
 * A database nobody has the key for is not an empty database, and must never be
 * drawn as one: an empty list with a New note button invites someone to write
 * over notes that are still there, encrypted, on disk.
 */
describe("the Clips tab", () => {
  it("lists what Rust says was copied, and copies an entry back through Rust", async () => {
    render(<Panel className="" />);
    await waitFor(() => {
      expect(listeners.has("clips:changed")).toBe(true);
    });
    listeners.get("clips:changed")?.({
      payload: [
        { id: 2, text: "on the clipboard", copiedAt: Date.now(), current: true },
        { id: 1, text: "ssh deploy@example.com", copiedAt: Date.now(), current: false },
      ],
    });
    fireEvent.click(screen.getByRole("tab", { name: "Clips" }));
    expect((await screen.findByText("On the clipboard")).closest("li")?.getAttribute("aria-current")).toBe("true");

    fireEvent.click(await screen.findByRole("button", { name: "Copy ssh deploy@example.com" }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("share_copy_text", { text: "ssh deploy@example.com" });
    });
    expect(await screen.findByText("Copied")).toBeTruthy();
  });
});

describe("a locked database", () => {
  it("takes the panel, instead of showing an empty list", async () => {
    securityInDb = {
      captureProtection: true,
      protection: "locked",
      detail: "the notes are encrypted and this system's keychain has no key for them",
    };
    render(<Panel className="" />);

    await waitFor(() => {
      expect(screen.getByText("Your notes are locked")).toBeTruthy();
    });
    expect(screen.queryByText("Standup notes")).toBeNull();
    expect(screen.queryByRole("button", { name: "New note" })).toBeNull();
  });

  it("shows the notes once a key opens them", async () => {
    securityInDb = {
      captureProtection: true,
      protection: "locked",
      detail: "the notes are encrypted and this system's keychain has no key for them",
    };
    render(<Panel className="" />);
    await waitFor(() => {
      expect(screen.getByText("Your notes are locked")).toBeTruthy();
    });

    securityInDb = { captureProtection: true, protection: "on", detail: "" };
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "a".repeat(64) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    await waitFor(() => {
      expect(screen.getByText("Standup notes")).toBeTruthy();
    });
  });
});
