// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invoke(command, args),
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => undefined),
}));

const { NoteEditor } = await import("../NoteEditor");
const { useNotesStore } = await import("../../store/notes");

const TABLE = "Costs\n| Day | Cost |\n| --- | --- |\n| Mon | 12 |";

const note = {
  id: "1",
  content: TABLE,
  color: "yellow" as const,
  pinned: false,
  createdAt: 1_000,
  updatedAt: 1_000,
  sortOrder: null,
};

/** The editor writes through the store, and the store only saves what it holds. */
function open(content: string) {
  const held = { ...note, content };
  useNotesStore.setState({ notes: [held], editingId: held.id, loaded: true });
  return held;
}

function saved(): string | null {
  const calls = invoke.mock.calls.filter(([command]) => command === "notes_update");
  return ((calls.at(-1)?.[1] as { content?: string } | undefined)?.content) ?? null;
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ ...note, updatedAt: 2_000 });
});

afterEach(() => {
  cleanup();
});

/**
 * A table is edited in place, and what is typed has to reach the note's text —
 * that text is the only place a table is kept.
 */
describe("editing a table", () => {
  it("types into a cell and writes it back as Markdown", async () => {
    render(<NoteEditor note={open(TABLE)} />);

    const cell = await screen.findByRole("textbox", { name: "Row 1, column 1" });
    fireEvent.change(cell, { target: { value: "Tue" } });

    await waitFor(() => {
      expect(saved()).toBe("Costs\n| Day | Cost |\n| --- | --- |\n| Tue | 12 |");
    });
  });

  it("adds and removes rows and columns from the grid's own edges", async () => {
    render(<NoteEditor note={open(TABLE)} />);

    fireEvent.click(await screen.findByRole("button", { name: "Add row" }));
    await waitFor(() => {
      expect(saved()).toBe("Costs\n| Day | Cost |\n| --- | --- |\n| Mon | 12 |\n|  |  |");
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove row 2" }));
    await waitFor(() => {
      expect(saved()).toBe("Costs\n| Day | Cost |\n| --- | --- |\n| Mon | 12 |");
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove column 2" }));
    await waitFor(() => {
      expect(saved()).toBe("Costs\n| Day |\n| --- |\n| Mon |");
    });

    fireEvent.click(screen.getByRole("button", { name: "Add column" }));
    await waitFor(() => {
      expect(saved()).toBe("Costs\n| Day |  |\n| --- | --- |\n| Mon |  |");
    });
  });

  it("never removes the last column, which would leave no table at all", async () => {
    render(<NoteEditor note={open("| a |\n| --- |\n| 1 |")} />);
    const only = await screen.findByRole("button", { name: "Remove column 1" });
    expect(only.hasAttribute("disabled")).toBe(true);
  });
});
