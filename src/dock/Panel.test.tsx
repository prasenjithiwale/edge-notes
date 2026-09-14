// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import type { Note, Settings } from "../lib/ipc";

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
};

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
  invoke.mockImplementation((command: string) => {
    if (command === "notes_list") {
      return Promise.resolve(NOTES);
    }
    if (command === "settings_get" || command === "settings_update") {
      return Promise.resolve(SETTINGS);
    }
    if (command === "notes_create") {
      return Promise.resolve(note({ id: "new", color: "yellow", updatedAt: 40 }));
    }
    return Promise.resolve(null);
  });
  useDockStore.setState({ locks: new Set() });
  useNotesStore.setState({
    notes: [],
    loaded: false,
    editingId: null,
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
    expect(screen.queryByRole("heading", { name: "Notes" })).toBeNull();

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
