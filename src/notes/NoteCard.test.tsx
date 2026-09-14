// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import type { Note } from "../lib/ipc";

const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invoke(command, args),
}));

const { NoteCard } = await import("./NoteCard");

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "1",
    content: "Standup notes\nDeploy the fix",
    color: "yellow",
    pinned: false,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

/** The handlers a test does not care about. */
const noop = { onExpand: () => undefined, onToggleTask: () => undefined };

afterEach(() => {
  cleanup();
});

describe("an unpinned card", () => {
  it("opens the editor when the card is clicked (brief 6.8)", () => {
    const onOpen = vi.fn();
    render(<NoteCard note={note()} onOpen={onOpen} onUnpin={() => undefined} {...noop} />);

    screen.getByText("Standup notes").click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("opens the editor from its keyboard target, the covering button", () => {
    const onOpen = vi.fn();
    const { container } = render(
      <NoteCard note={note()} onOpen={onOpen} onUnpin={() => undefined} {...noop} />,
    );
    const target = container.querySelector<HTMLElement>("[data-card]");
    expect(target?.tagName).toBe("BUTTON");
    target?.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("offers no edit button, because the whole card is one", () => {
    render(<NoteCard note={note()} onOpen={() => undefined} onUnpin={() => undefined} {...noop} />);
    expect(screen.queryByRole("button", { name: "Edit note" })).toBeNull();
  });
});

describe("formatting on a card", () => {
  it("renders bold and italic, and names the card without the markers", () => {
    const { container } = render(
      <NoteCard
        note={note({ content: "**Standup** _notes_\nDeploy ~~today~~" })}
        onOpen={() => undefined}
        onUnpin={() => undefined}
        {...noop}
      />,
    );

    expect(container.querySelector("strong")?.textContent).toBe("Standup");
    expect(container.querySelector("em")?.textContent).toBe("notes");
    expect(container.querySelector("s")?.textContent).toBe("today");
    expect(screen.getByRole("button", { name: "Standup notes" })).toBeTruthy();
  });

  it("ticks a box without opening the editor", () => {
    const onOpen = vi.fn();
    const onToggleTask = vi.fn();
    render(
      <NoteCard
        note={note({ content: "Groceries\n- [ ] milk\n- [x] eggs" })}
        onOpen={onOpen}
        onUnpin={() => undefined}
        onExpand={() => undefined}
        onToggleTask={onToggleTask}
      />,
    );

    const eggs = screen.getByRole("checkbox", { name: "eggs" });
    expect(eggs.getAttribute("aria-checked")).toBe("true");
    eggs.click();

    expect(onToggleTask).toHaveBeenCalledWith(2);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens a link in the browser, not in the widget, and not the editor", () => {
    const onOpen = vi.fn();
    render(
      <NoteCard
        note={note({ content: "Docs\nsee https://example.com/guide." })}
        onOpen={onOpen}
        onUnpin={() => undefined}
        {...noop}
      />,
    );

    const link = screen.getByRole("link", { name: "https://example.com/guide" });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(invoke).toHaveBeenCalledWith("open_url", { url: "https://example.com/guide" });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("says how many checklist items did not fit", () => {
    const items = Array.from({ length: 7 }, (_, i) => `- [ ] item ${String(i)}`);
    render(
      <NoteCard
        note={note({ content: ["Packing", ...items].join("\n") })}
        onOpen={() => undefined}
        onUnpin={() => undefined}
        {...noop}
      />,
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(5);
    expect(screen.getByText("2 more")).toBeTruthy();
  });
});

describe("expanding from a card", () => {
  it("expands without also opening the editor", () => {
    const onOpen = vi.fn();
    const onExpand = vi.fn();
    render(
      <NoteCard
        note={note()}
        onOpen={onOpen}
        onUnpin={() => undefined}
        onExpand={onExpand}
        onToggleTask={() => undefined}
      />,
    );

    screen.getByRole("button", { name: "Expand note" }).click();
    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("offers expand on a pinned card too", () => {
    const onExpand = vi.fn();
    render(
      <NoteCard
        note={note({ pinned: true })}
        onOpen={() => undefined}
        onUnpin={() => undefined}
        onExpand={onExpand}
        onToggleTask={() => undefined}
      />,
    );
    screen.getByRole("button", { name: "Expand note" }).click();
    expect(onExpand).toHaveBeenCalledTimes(1);
  });
});

describe("a pinned card", () => {
  it("does not open the editor when its text is clicked", () => {
    // The point of pinning: read and copy without editing by accident.
    const onOpen = vi.fn();
    render(
      <NoteCard note={note({ pinned: true })} onOpen={onOpen} onUnpin={() => undefined} {...noop} />,
    );

    screen.getByText("Standup notes").click();
    screen.getByText("Deploy the fix").click();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens the editor only through the edit button", () => {
    const onOpen = vi.fn();
    render(
      <NoteCard note={note({ pinned: true })} onOpen={onOpen} onUnpin={() => undefined} {...noop} />,
    );

    screen.getByRole("button", { name: "Edit note" }).click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("keeps the text selectable so it can be copied in place", () => {
    render(
      <NoteCard
        note={note({ pinned: true })}
        onOpen={() => undefined}
        onUnpin={() => undefined}
        {...noop}
      />,
    );

    // The title's container is the selectable region; a <button> could not be
    // selected at all, which is why a pinned card is not one.
    const text = screen.getByText("Standup notes").parentElement;
    expect(text?.className).toContain("text");
    expect(text?.closest("button")).toBeNull();
  });

  it("can be unpinned from the card", () => {
    const onUnpin = vi.fn();
    render(
      <NoteCard note={note({ pinned: true })} onOpen={() => undefined} onUnpin={onUnpin} {...noop} />,
    );

    screen.getByRole("button", { name: "Unpin note" }).click();
    expect(onUnpin).toHaveBeenCalledTimes(1);
  });

  it("does not paint the pin in the accent colour (brief 7.1)", () => {
    render(
      <NoteCard note={note({ pinned: true })} onOpen={() => undefined} onUnpin={() => undefined} {...noop} />,
    );

    const unpin = screen.getByRole("button", { name: "Unpin note" });
    expect(unpin.className).not.toContain("active");
    expect(unpin.getAttribute("aria-pressed")).toBe("true");
  });

  it("stays reachable by keyboard through its edit button (brief 6.11)", () => {
    // Arrow-key navigation looks for [data-card]; on a pinned note the card is
    // no longer a button, so the marker moves to the pencil.
    const { container } = render(
      <NoteCard
        note={note({ pinned: true })}
        onOpen={() => undefined}
        onUnpin={() => undefined}
        {...noop}
      />,
    );

    const target = container.querySelector("[data-card]");
    expect(target?.tagName).toBe("BUTTON");
    expect(target?.getAttribute("aria-label")).toBe("Edit note");
  });
});
