// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invoke(command, args),
  convertFileSrc: (path: string, protocol: string) => `${protocol}://localhost/${path}`,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => undefined),
}));

const { NoteEditor } = await import("../NoteEditor");
const { useNotesStore } = await import("../../store/notes");

const IMAGE = "ledge://localhost/0199a000-0000-7000-8000-000000000001.png";

const note = {
  id: "1",
  content: `A picture\n![](${IMAGE})`,
  color: "yellow" as const,
  pinned: false,
  createdAt: 1_000,
  updatedAt: 1_000,
  sortOrder: null,
};

/** jsdom lays nothing out, so the sizes the drag reads have to be given to it. */
function withLayout(element: Element, width: number) {
  element.getBoundingClientRect = () =>
    ({ width, height: width, top: 0, left: 0, right: width, bottom: width, x: 0, y: 0 }) as DOMRect;
  // The cap the drag clamps to is the editable's content width, and jsdom
  // reports 0 for every box it has not laid out.
  Object.defineProperty(element, "clientWidth", { value: width, configurable: true });
}

/**
 * The editor writes through the notes store, and the store only saves a note it
 * is holding — so the note has to be in it, exactly as it is when the panel
 * opens the editor on a card.
 */
function open(content: string) {
  const held = { ...note, content };
  useNotesStore.setState({ notes: [held], editingId: held.id, loaded: true });
  return held;
}

/** What the note would be saved as right now. */
function saved(): string | null {
  const calls = invoke.mock.calls.filter(([command]) => command === "notes_update");
  const last = calls.at(-1)?.[1] as { content?: string } | undefined;
  return last?.content ?? null;
}

afterEach(() => {
  cleanup();
  invoke.mockReset();
  vi.useRealTimers();
});

/**
 * Dragging the corner of a picture. The width has to reach the note's text,
 * because that text is the only place a size is kept — if the drag ends and
 * nothing is written, the picture is back to its old size the next time the
 * note is opened.
 */
describe("resizing a picture", () => {
  it("writes the new width into the note", async () => {
    invoke.mockResolvedValue({ ...note, updatedAt: 2_000 });
    render(<NoteEditor note={open(note.content)} />);

    const handle = await screen.findByRole("button", { name: "Resize image" });
    const wrap = handle.parentElement;
    expect(wrap).not.toBeNull();
    withLayout(wrap as Element, 200);
    // Only the editable root is given a width, exactly as the browser does.
    // Lexical marks its decorator wrapper `contenteditable="false"`, and that
    // span is inline, so its `clientWidth` is 0 — the drag's cap used to match
    // it with a loose `[contenteditable]` selector and clamp every drag to the
    // minimum width.
    withLayout(document.querySelector('[contenteditable="true"]') as Element, 296);

    fireEvent.pointerDown(handle, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 260, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 260, pointerId: 1 });

    await waitFor(() => {
      expect(saved()).toContain(`![|260](${IMAGE})`);
    });
  });

  it("follows the pointer instead of collapsing to the smallest size", async () => {
    // The regression: with the cap read off the wrong ancestor, every drag
    // ended at MIN_IMAGE_WIDTH whichever way it was dragged.
    invoke.mockResolvedValue({ ...note, updatedAt: 2_000 });
    render(<NoteEditor note={open(note.content)} />);

    const handle = await screen.findByRole("button", { name: "Resize image" });
    withLayout(handle.parentElement as Element, 280);
    withLayout(document.querySelector('[contenteditable="true"]') as Element, 296);

    fireEvent.pointerDown(handle, { clientX: 307, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 220, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 220, pointerId: 1 });

    await waitFor(() => {
      expect(saved()).toContain(`![|193](${IMAGE})`);
    });
  });

  it("puts a picture back to its own size when the corner is clicked", async () => {
    invoke.mockResolvedValue({ ...note, updatedAt: 2_000 });
    render(<NoteEditor note={open(`A picture\n![|120](${IMAGE})`)} />);

    const handle = await screen.findByRole("button", { name: "Resize image" });
    withLayout(handle.parentElement as Element, 120);
    withLayout(document.querySelector('[contenteditable="true"]') as Element, 296);

    fireEvent.pointerDown(handle, { clientX: 120, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 120, pointerId: 1 });

    await waitFor(() => {
      expect(saved()).toContain(`![](${IMAGE})`);
    });
  });
});
