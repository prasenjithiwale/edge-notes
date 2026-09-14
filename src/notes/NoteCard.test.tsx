// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import type { Note } from "../lib/ipc";
import { NoteCard } from "./NoteCard";

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

afterEach(() => {
  cleanup();
});

describe("an unpinned card", () => {
  it("opens the editor when the card is clicked (brief 6.8)", () => {
    const onOpen = vi.fn();
    render(<NoteCard note={note()} onOpen={onOpen} onUnpin={() => undefined} />);

    screen.getByText("Standup notes").click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("offers no edit button, because the whole card is one", () => {
    render(<NoteCard note={note()} onOpen={() => undefined} onUnpin={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Edit note" })).toBeNull();
  });
});

describe("a pinned card", () => {
  it("does not open the editor when its text is clicked", () => {
    // The point of pinning: read and copy without editing by accident.
    const onOpen = vi.fn();
    render(
      <NoteCard note={note({ pinned: true })} onOpen={onOpen} onUnpin={() => undefined} />,
    );

    screen.getByText("Standup notes").click();
    screen.getByText("Deploy the fix").click();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens the editor only through the edit button", () => {
    const onOpen = vi.fn();
    render(
      <NoteCard note={note({ pinned: true })} onOpen={onOpen} onUnpin={() => undefined} />,
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
      <NoteCard note={note({ pinned: true })} onOpen={() => undefined} onUnpin={onUnpin} />,
    );

    screen.getByRole("button", { name: "Unpin note" }).click();
    expect(onUnpin).toHaveBeenCalledTimes(1);
  });

  it("does not paint the pin in the accent colour (brief 7.1)", () => {
    render(
      <NoteCard note={note({ pinned: true })} onOpen={() => undefined} onUnpin={() => undefined} />,
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
      />,
    );

    const target = container.querySelector("[data-card]");
    expect(target?.tagName).toBe("BUTTON");
    expect(target?.getAttribute("aria-label")).toBe("Edit note");
  });
});
