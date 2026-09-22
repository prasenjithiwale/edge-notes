// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import type { Note } from "../lib/ipc";
import { NoteList } from "./NoteList";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve(undefined),
}));

function note(id: string): Note {
  return {
    id,
    content: id,
    color: "yellow",
    pinned: false,
    createdAt: 0,
    updatedAt: 0,
    sortOrder: null,
  };
}

/** What a real drag hands the handlers; jsdom has no DataTransfer of its own. */
function dataTransfer() {
  return { effectAllowed: "", setData: vi.fn(), getData: () => "" };
}

function slots(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>("[data-note-id]")];
}

afterEach(() => {
  cleanup();
});

/**
 * Idea 16. The drop's arithmetic is the whole of it: the card comes out of the
 * list before it goes back in, or moving one down by a place would put it where
 * it already was.
 */
describe("dragging a note into a new place", () => {
  const notes = [note("a"), note("b"), note("c")];

  it("sends the whole list in its new order", () => {
    const onReorder = vi.fn();
    const { container } = render(
      <NoteList
        notes={notes}
        editingId={null}
        onOpen={() => undefined}
        onUnpin={() => undefined}
        onExpand={() => undefined}
        onToggleTask={() => undefined}
        onReorder={onReorder}
      />,
    );

    const rows = slots(container);
    const [first, , third] = rows;
    if (first === undefined || third === undefined) {
      throw new Error("the list did not render three cards");
    }
    // jsdom gives every element a zero-height box, so the cursor is at the top
    // half of the target: the drop goes above it.
    fireEvent.dragStart(third, { dataTransfer: dataTransfer() });
    fireEvent.dragOver(first, { dataTransfer: dataTransfer(), clientY: 0 });
    fireEvent.drop(first, { dataTransfer: dataTransfer() });

    expect(onReorder).toHaveBeenCalledWith(["c", "a", "b"]);
  });

  it("cannot be dragged at all when the list is filtered", () => {
    const { container } = render(
      <NoteList
        notes={notes}
        editingId={null}
        onOpen={() => undefined}
        onUnpin={() => undefined}
        onExpand={() => undefined}
        onToggleTask={() => undefined}
      />,
    );
    expect(slots(container).every((slot) => slot.draggable)).toBe(false);
  });
});
