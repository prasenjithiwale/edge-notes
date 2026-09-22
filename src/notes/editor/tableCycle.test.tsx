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

const note = {
  id: "1",
  content: "",
  color: "yellow" as const,
  pinned: false,
  createdAt: 1_000,
  updatedAt: 1_000,
  sortOrder: null,
};

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
 * The whole journey a table actually takes: inserted from the slash menu into a
 * note being written, typed into, saved, and opened again. Every earlier test
 * started from a table that was already in the text, which is the one way it
 * never arrives.
 */
describe("a table from the slash menu", () => {
  it("is still a table after it is saved and opened again", async () => {
    const { unmount } = render(<NoteEditor note={open("Costs")} />);

    // What the menu does: type `/table` and pick it.
    const editable = document.querySelector('[contenteditable="true"]');
    expect(editable).not.toBeNull();
    fireEvent.focus(editable as Element);
    const { runCommand } = await import("./toolbar");
    const { $getRoot } = await import("lexical");
    const lexical = (editable as unknown as { __lexicalEditor?: unknown }).__lexicalEditor;
    expect(lexical).toBeDefined();
    const editor = lexical as Parameters<typeof runCommand>[0];
    editor.update(
      () => {
        $getRoot().selectEnd();
      },
      { discrete: true },
    );
    runCommand(editor, "table", {
      bold: false,
      italic: false,
      strike: false,
      code: false,
      list: null,
      heading: 0,
    });
    editor.update(() => undefined, { discrete: true });

    const cell = await screen.findByRole("textbox", { name: "Column 1 heading" });
    fireEvent.change(cell, { target: { value: "Day" } });

    await waitFor(() => {
      expect(saved()).not.toBeNull();
    });
    const stored = saved() ?? "";
    expect(stored).toContain("| Day |");
    expect(stored).toContain("| --- |");

    // Closed and opened again: the text has to come back as a grid.
    unmount();
    render(<NoteEditor note={open(stored)} />);
    expect(await screen.findByRole("textbox", { name: "Column 1 heading" })).toBeTruthy();
  });
});
