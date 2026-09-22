import { describe, expect, it } from "vitest";

import type { Note } from "./ipc";
import { extractTags, facetTags, hasTag, splitTags } from "./tags";

function note(content: string, id = "a"): Note {
  return {
    id,
    content,
    color: "yellow",
    pinned: false,
    createdAt: 0,
    updatedAt: 0,
    sortOrder: null,
  };
}

/**
 * A tag is plain text that the app happens to read. What matters is what it
 * refuses to call a tag: the dialect's own heading, a URL fragment, and anything
 * inside code — each of those would put a chip on the filter row for something
 * nobody tagged.
 */
describe("tags in note text", () => {
  it("finds tags anywhere a word can start", () => {
    expect(extractTags("#work call the bank (#money) later #work")).toEqual([
      "work",
      "money",
    ]);
  });

  it("is not fooled by a heading, an anchor or code", () => {
    expect(extractTags("# Heading\nsee https://example.com/#anchor")).toEqual([]);
    expect(extractTags("`#notatag` and ```\n#!/bin/sh\n```")).toEqual([]);
    expect(extractTags("# ")).toEqual([]);
  });

  it("treats one tag written two ways as one, and shows the first spelling", () => {
    expect(extractTags("#Work then #work")).toEqual(["Work"]);
    expect(hasTag(note("#Work"), "work")).toBe(true);
  });

  it("orders the filter row by use, then alphabetically", () => {
    const notes = [note("#home #work", "a"), note("#work", "b"), note("#admin", "c")];
    expect(facetTags(notes)).toEqual(["work", "admin", "home"]);
  });

  it("keeps the selected tag even when nothing has it any more", () => {
    expect(facetTags([note("#work")], "gone")).toContain("gone");
  });

  it("splits a line into the words around its tags", () => {
    expect(splitTags("pay #rent today")).toEqual(["pay ", { tag: "rent" }, " today"]);
    expect(splitTags("nothing here")).toEqual(["nothing here"]);
  });
});
