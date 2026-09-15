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

    // The title sits inside the selectable region; a <button> could not be
    // selected at all, which is why a pinned card is not one.
    const title = screen.getByText("Standup notes");
    expect(title.closest("[class*='selectable']")).not.toBeNull();
    expect(title.closest("button")).toBeNull();
  });

  it("can be unlocked from the card", () => {
    const onUnpin = vi.fn();
    render(
      <NoteCard note={note({ pinned: true })} onOpen={() => undefined} onUnpin={onUnpin} {...noop} />,
    );

    screen.getByRole("button", { name: "Unlock note" }).click();
    expect(onUnpin).toHaveBeenCalledTimes(1);
  });

  it("does not paint the lock in the accent colour (brief 7.1)", () => {
    render(
      <NoteCard note={note({ pinned: true })} onOpen={() => undefined} onUnpin={() => undefined} {...noop} />,
    );

    const unpin = screen.getByRole("button", { name: "Unlock note" });
    expect(unpin.className).not.toContain("active");
    expect(unpin.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the whole note, not a preview, however long it is", () => {
    // The point of locking a note is keeping it in front of you, so nothing may
    // be cut off — neither the checklist limit nor the paragraph clamp applies.
    const lines = Array.from({ length: 60 }, (_, i) => `line ${String(i)}`);
    render(
      <NoteCard
        note={note({ pinned: true, content: ["Long note", ...lines].join("\n") })}
        onOpen={() => undefined}
        onUnpin={() => undefined}
        {...noop}
      />,
    );

    for (const line of lines) {
      expect(screen.getByText(line)).toBeTruthy();
    }
    expect(screen.queryByText(/\d+ more/)).toBeNull();
  });

  it("keeps every checklist item, where an unlocked card stops at five", () => {
    const items = Array.from({ length: 7 }, (_, i) => `- [ ] item ${String(i)}`);
    const content = ["Packing", ...items].join("\n");
    const { unmount } = render(
      <NoteCard
        note={note({ pinned: true, content })}
        onOpen={() => undefined}
        onUnpin={() => undefined}
        {...noop}
      />,
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(7);
    expect(screen.queryByText("2 more")).toBeNull();
    unmount();

    render(
      <NoteCard
        note={note({ content })}
        onOpen={() => undefined}
        onUnpin={() => undefined}
        {...noop}
      />,
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(5);
  });

  it("gives each line its own row instead of running them together", () => {
    // An unlocked card flows paragraph lines into one clamped run of text; a
    // locked one must not, or a note typed as several lines reads as one.
    const content = "Shopping\nmilk\neggs";
    const { container, unmount } = render(
      <NoteCard
        note={note({ pinned: true, content })}
        onOpen={() => undefined}
        onUnpin={() => undefined}
        {...noop}
      />,
    );

    // Each line is its own element with exactly its own text on it.
    expect(screen.getByText("milk").textContent).toBe("milk");
    expect(screen.getByText("eggs").textContent).toBe("eggs");
    expect(container.textContent).toBe("Shoppingmilkeggs");
    unmount();

    // The same note unlocked: the two body lines share one run of text.
    render(
      <NoteCard
        note={note({ content })}
        onOpen={() => undefined}
        onUnpin={() => undefined}
        {...noop}
      />,
    );
    expect(screen.getByText("milk eggs")).toBeTruthy();
  });

  it("keeps blank lines as the paragraph breaks they are", () => {
    const { container } = render(
      <NoteCard
        note={note({ pinned: true, content: "Title\n\nFirst para\n\n\nSecond para" })}
        onOpen={() => undefined}
        onUnpin={() => undefined}
        {...noop}
      />,
    );

    // Three blank lines in the content, three breaks on the card.
    expect(container.querySelectorAll("[class*='blank']")).toHaveLength(3);
    expect(screen.getByText("First para")).toBeTruthy();
    expect(screen.getByText("Second para")).toBeTruthy();
  });

  it("wraps its lines rather than clipping them to one", () => {
    const long = "a".repeat(400);
    const { container } = render(
      <NoteCard
        note={note({ pinned: true, content: `Wide\n${long}` })}
        onOpen={() => undefined}
        onUnpin={() => undefined}
        {...noop}
      />,
    );

    expect(screen.getByText(long)).toBeTruthy();
    // `wrap` is what turns off the one-line ellipsis in NoteText.module.css.
    expect(container.querySelectorAll("[class*='wrap']").length).toBeGreaterThan(0);
  });

  it("ticks a box on a line a preview would never have shown", () => {
    const onToggleTask = vi.fn();
    const items = Array.from({ length: 7 }, (_, i) => `- [ ] item ${String(i)}`);
    render(
      <NoteCard
        note={note({ pinned: true, content: ["Packing", ...items].join("\n") })}
        onOpen={() => undefined}
        onUnpin={() => undefined}
        onExpand={() => undefined}
        onToggleTask={onToggleTask}
      />,
    );

    screen.getByRole("checkbox", { name: "item 6" }).click();
    // Line 7 of the content, counted from the title on line 0.
    expect(onToggleTask).toHaveBeenCalledWith(7);
  });

  it("still says New note when there is nothing to show", () => {
    render(
      <NoteCard
        note={note({ pinned: true, content: "" })}
        onOpen={() => undefined}
        onUnpin={() => undefined}
        {...noop}
      />,
    );
    expect(screen.getByText("New note")).toBeTruthy();
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
