// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invoke(command, args),
}));

const { QuickCapture } = await import("./QuickCapture");

/** What `invoke` was called with, for one command. */
function argsFor(command: string): unknown[] {
  return invoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args);
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((command) => {
    switch (command) {
      case "quick_capture_prefill":
        return Promise.resolve(null);
      case "notes_create":
        return Promise.resolve({ id: "note-1" });
      case "tasks_create":
        return Promise.resolve({ id: "task-1" });
      case "notes_list":
      case "tasks_list":
        return Promise.resolve([]);
      default:
        return Promise.resolve(undefined);
    }
  });
});

afterEach(() => {
  cleanup();
});

/**
 * Brief 14. The field exists to be gone in a second, so what matters is that
 * Enter puts what was typed somewhere it can be found again, Escape throws
 * nothing away silently, and a line that starts `[ ]` lands in Tasks rather
 * than as a note that looks like one.
 */
describe("quick capture", () => {
  it("saves a line as a note and closes", async () => {
    render(<QuickCapture />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  milk  " } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    await waitFor(() => {
      expect(argsFor("notes_update")).toEqual([{ id: "note-1", content: "milk", color: null }]);
    });
    await waitFor(() => {
      expect(argsFor("quick_capture_close")).toHaveLength(1);
    });
    expect(argsFor("tasks_create")).toEqual([]);
  });

  it("makes a task of a line that starts with a box, parsed like the add field", async () => {
    render(<QuickCapture />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "[ ] call the bank !high" },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    await waitFor(() => {
      expect(argsFor("tasks_create")).toEqual([
        {
          patch: {
            title: "call the bank",
            priority: "high",
            dueDate: null,
            dueTime: null,
            repeat: null,
          },
        },
      ]);
    });
    expect(argsFor("notes_create")).toEqual([]);
  });

  it("closes on Escape without saving anything", async () => {
    render(<QuickCapture />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "not this" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });

    await waitFor(() => {
      expect(argsFor("quick_capture_close")).toHaveLength(1);
    });
    expect(argsFor("notes_create")).toEqual([]);
    expect(argsFor("tasks_create")).toEqual([]);
  });

  it("opens with the clipboard when that is what summoned it", async () => {
    invoke.mockImplementation((command) =>
      command === "quick_capture_prefill"
        ? Promise.resolve("pasted")
        : Promise.resolve(command === "notes_create" ? { id: "note-1" } : undefined),
    );
    render(<QuickCapture />);

    await waitFor(() => {
      const field: HTMLTextAreaElement = screen.getByRole("textbox");
      expect(field.value).toBe("pasted");
    });
  });
});
