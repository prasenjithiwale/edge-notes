import { describe, expect, it } from "vitest";

import type { Note } from "./ipc";
import {
  colorName,
  editedLabel,
  facetColors,
  filterNotes,
  isNoteEmpty,
  quickColors,
  recentColors,
  sortNotes,
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
    pinned: false,
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
    ...overrides,
  };
}

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

describe("facetColors", () => {
  it("keeps palette order rather than first-seen order", () => {
    const notes = [
      note({ id: "a", color: "gray" }),
      note({ id: "b", color: "peach" }),
      note({ id: "c", color: "blue" }),
    ];
    expect(facetColors(notes, PALETTE)).toEqual(["peach", "blue", "gray"]);
  });

  it("keeps the selected colour even when nothing matches it", () => {
    const notes = [note({ id: "a", color: "yellow" })];
    // Deleting the last pink note must not take the dot that clears the filter.
    expect(facetColors(notes, PALETTE, "pink")).toEqual(["yellow", "pink"]);
  });

  it("does not duplicate a selected colour that is still in use", () => {
    const notes = [note({ id: "a", color: "mint" })];
    expect(facetColors(notes, PALETTE, "mint")).toEqual(["mint"]);
  });

  it("is empty when there are no notes and no selection", () => {
    expect(facetColors([], PALETTE)).toEqual([]);
  });
});

describe("recentColors", () => {
  it("takes the three most recently edited, newest first", () => {
    const notes = [
      note({ id: "a", color: "yellow", updatedAt: 3_000 }),
      note({ id: "b", color: "pink", updatedAt: 5_000 }),
      note({ id: "c", color: "blue", updatedAt: 4_000 }),
      note({ id: "d", color: "mint", updatedAt: 1_000 }),
    ];
    expect(recentColors(notes)).toEqual(["pink", "blue", "yellow"]);
  });

  it("sorts for itself, because the list is unsorted while editing", () => {
    const notes = [
      note({ id: "a", color: "gray", updatedAt: 1_000 }),
      note({ id: "b", color: "peach", updatedAt: 9_000 }),
    ];
    expect(recentColors(notes)).toEqual(["peach", "gray"]);
  });

  it("keeps duplicates: three yellow notes give three yellow dots", () => {
    const notes = [
      note({ id: "a", color: "yellow", updatedAt: 3_000 }),
      note({ id: "b", color: "yellow", updatedAt: 2_000 }),
      note({ id: "c", color: "yellow", updatedAt: 1_000 }),
    ];
    expect(recentColors(notes)).toEqual(["yellow", "yellow", "yellow"]);
  });

  it("returns nothing for an empty list", () => {
    expect(recentColors([])).toEqual([]);
  });
});

describe("editedLabel", () => {
  const now = 1_760_000_000_000;

  it("reads as just now for a few seconds", () => {
    expect(editedLabel(now - 5_000, now)).toBe("Edited just now");
  });

  it("switches to minutes at a minute", () => {
    expect(editedLabel(now - 60_000, now)).toBe("Edited 1m ago");
    expect(editedLabel(now - 59 * 60_000, now)).toBe("Edited 59m ago");
  });

  it("switches to hours at an hour", () => {
    expect(editedLabel(now - 3_600_000, now)).toBe("Edited 1h ago");
    expect(editedLabel(now - 2 * 3_600_000, now)).toBe("Edited 2h ago");
  });

  it("switches to days at a day and months at thirty", () => {
    expect(editedLabel(now - 25 * 3_600_000, now)).toBe("Edited 1d ago");
    expect(editedLabel(now - 31 * 24 * 3_600_000, now)).toBe("Edited 1mo ago");
  });

  it("treats a future timestamp as just now instead of a negative age", () => {
    expect(editedLabel(now + 10_000, now)).toBe("Edited just now");
  });
});

describe("colorName", () => {
  it("capitalises a palette id for a label", () => {
    expect(colorName("lavender")).toBe("Lavender");
    expect(colorName("gray")).toBe("Gray");
  });
});

describe("sortNotes with pinned notes", () => {
  it("puts pinned notes above more recently edited ones", () => {
    const notes = [
      note({ id: "a", updatedAt: 9_000 }),
      note({ id: "b", updatedAt: 1_000, pinned: true }),
      note({ id: "c", updatedAt: 5_000 }),
    ];
    expect(sortNotes(notes).map((n) => n.id)).toEqual(["b", "a", "c"]);
  });

  it("still sorts pinned notes among themselves by edit time", () => {
    const notes = [
      note({ id: "a", updatedAt: 1_000, pinned: true }),
      note({ id: "b", updatedAt: 8_000, pinned: true }),
    ];
    expect(sortNotes(notes).map((n) => n.id)).toEqual(["b", "a"]);
  });
});

describe("recentColors with pinned notes", () => {
  it("ignores pinning: the tab shows the most recently edited notes (brief 6.5)", () => {
    const notes = [
      note({ id: "a", color: "gray", updatedAt: 1_000, pinned: true }),
      note({ id: "b", color: "pink", updatedAt: 5_000 }),
      note({ id: "c", color: "blue", updatedAt: 4_000 }),
      note({ id: "d", color: "mint", updatedAt: 3_000 }),
    ];
    expect(recentColors(notes)).toEqual(["pink", "blue", "mint"]);
  });
});

describe("quickColors", () => {
  const WHEEL = ["red", "yellow", "teal", "blue", "pink", "gray"] as const;
  const CLASSIC = ["yellow", "pink", "blue", "gray"] as const;

  it("keeps the current colour, then recent note colours, topped up from the defaults", () => {
    const notes = [
      note({ id: "a", color: "blue", updatedAt: 30 }),
      note({ id: "b", color: "red", updatedAt: 20 }),
    ];
    // Palette order, not recency order, so the row does not reshuffle.
    expect(quickColors("teal", notes, WHEEL, CLASSIC, 4)).toEqual(["red", "yellow", "teal", "blue"]);
  });

  it("never repeats a colour or exceeds the count", () => {
    const notes = [note({ id: "a", color: "pink" }), note({ id: "b", color: "pink" })];
    const colors = quickColors("pink", notes, WHEEL, CLASSIC, 3);
    expect(colors).toEqual(["yellow", "blue", "pink"]);
  });
});
