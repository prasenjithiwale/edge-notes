import { describe, expect, it } from "vitest";

import type { Note } from "./ipc";
import {
  filterNotes,
  isNoteEmpty,
  notePreview,
  noteTitle,
  sortNotes,
  usedColors,
} from "./notes";

const PALETTE = [
  "yellow",
  "peach",
  "pink",
  "lavender",
  "blue",
  "mint",
  "gray",
] as const;

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "01900000-0000-7000-8000-000000000001",
    content: "",
    color: "yellow",
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
    ...overrides,
  };
}

describe("noteTitle", () => {
  it("uses the first non-empty line", () => {
    expect(noteTitle("Standup notes\nDeploy the fix")).toBe("Standup notes");
  });

  it("skips leading blank lines rather than returning nothing", () => {
    expect(noteTitle("\n\n  \nGroceries\nMilk")).toBe("Groceries");
  });

  it("trims the line it picks", () => {
    expect(noteTitle("   Padded   \nrest")).toBe("Padded");
  });

  it("is empty for an empty note", () => {
    expect(noteTitle("")).toBe("");
    expect(noteTitle("   \n  ")).toBe("");
  });

  it("handles a single line with no body", () => {
    expect(noteTitle("Just this")).toBe("Just this");
  });
});

describe("notePreview", () => {
  it("is everything after the title line", () => {
    expect(notePreview("Groceries\nMilk, eggs\ncoffee")).toBe("Milk, eggs coffee");
  });

  it("is empty when there is only a title", () => {
    expect(notePreview("Just this")).toBe("");
  });

  it("starts after the title even when blank lines precede it", () => {
    expect(notePreview("\n\nTitle\nBody")).toBe("Body");
  });

  it("collapses runs of whitespace so the clamp measures real text", () => {
    expect(notePreview("Title\n\n\nBody    with   gaps")).toBe("Body with gaps");
  });

  it("is empty for an empty note", () => {
    expect(notePreview("")).toBe("");
  });
});

describe("isNoteEmpty", () => {
  it("treats whitespace-only content as empty, so it gets discarded", () => {
    expect(isNoteEmpty("")).toBe(true);
    expect(isNoteEmpty("   \n\t\n ")).toBe(true);
    expect(isNoteEmpty("x")).toBe(false);
  });
});

describe("sortNotes", () => {
  it("puts the most recently edited first", () => {
    const older = note({ id: "a", updatedAt: 1_000 });
    const newer = note({ id: "b", updatedAt: 2_000 });
    expect(sortNotes([older, newer]).map((n) => n.id)).toEqual(["b", "a"]);
  });

  it("breaks ties by id so the order never flickers", () => {
    const first = note({ id: "aaa", updatedAt: 1_000 });
    const second = note({ id: "bbb", updatedAt: 1_000 });
    expect(sortNotes([first, second]).map((n) => n.id)).toEqual(["bbb", "aaa"]);
    expect(sortNotes([second, first]).map((n) => n.id)).toEqual(["bbb", "aaa"]);
  });

  it("does not mutate its input", () => {
    const input = [note({ id: "a", updatedAt: 1 }), note({ id: "b", updatedAt: 2 })];
    sortNotes(input);
    expect(input.map((n) => n.id)).toEqual(["a", "b"]);
  });
});

describe("filterNotes", () => {
  const notes = [
    note({ id: "a", color: "blue", content: "Deploy the fix before 4pm" }),
    note({ id: "b", color: "mint", content: "Milk, eggs, coffee" }),
    note({ id: "c", color: "blue", content: "Call the dentist" }),
  ];

  it("returns everything when nothing is set", () => {
    expect(filterNotes(notes, {})).toHaveLength(3);
    expect(filterNotes(notes, { color: null, query: "" })).toHaveLength(3);
  });

  it("filters by colour", () => {
    expect(filterNotes(notes, { color: "blue" }).map((n) => n.id)).toEqual(["a", "c"]);
  });

  it("matches the query case-insensitively across the whole note", () => {
    expect(filterNotes(notes, { query: "COFFEE" }).map((n) => n.id)).toEqual(["b"]);
    expect(filterNotes(notes, { query: "dentist" }).map((n) => n.id)).toEqual(["c"]);
  });

  it("ignores surrounding whitespace in the query", () => {
    expect(filterNotes(notes, { query: "  milk  " }).map((n) => n.id)).toEqual(["b"]);
  });

  it("combines colour and query", () => {
    expect(filterNotes(notes, { color: "blue", query: "call" }).map((n) => n.id)).toEqual(["c"]);
    expect(filterNotes(notes, { color: "mint", query: "call" })).toEqual([]);
  });
});

describe("usedColors", () => {
  it("lists only colours that have notes, in palette order", () => {
    const notes = [note({ color: "mint" }), note({ color: "yellow" }), note({ color: "mint" })];
    expect(usedColors(notes, PALETTE)).toEqual(["yellow", "mint"]);
  });

  it("is empty when there are no notes", () => {
    expect(usedColors([], PALETTE)).toEqual([]);
  });
});
