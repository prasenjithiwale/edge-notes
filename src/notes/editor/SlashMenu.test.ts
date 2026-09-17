import { describe, expect, it } from "vitest";

import { BLOCKS } from "./SlashMenu";

/** What the menu offers, and how it decides what you meant. */
describe("the slash menu's blocks", () => {
  it("offers only what the note's storage format can hold", () => {
    // A menu item that wrote something the Markdown dialect cannot express
    // would be lost on the next save. Headings are the obvious absentee: they
    // need the dialect to learn `#` first.
    expect(BLOCKS.map((block) => block.command)).toEqual([
      "text",
      "task",
      "bullet",
      "ordered",
      "codeblock",
    ]);
  });

  it("shows everything for a bare slash, so it can be browsed", () => {
    expect(BLOCKS.filter((block) => block.matches(""))).toHaveLength(BLOCKS.length);
  });

  it("finds a block by its name", () => {
    const named = (query: string) =>
      BLOCKS.filter((block) => block.matches(query)).map((block) => block.label);
    expect(named("code")).toEqual(["Code block"]);
    expect(named("number")).toEqual(["Numbered list"]);
  });

  /** Nobody types "To-do list"; they type "todo". */
  it("finds a block by what someone would actually type", () => {
    const first = (query: string) =>
      BLOCKS.filter((block) => block.matches(query))[0]?.label ?? null;
    expect(first("todo")).toBe("To-do list");
    expect(first("check")).toBe("To-do list");
    expect(first("ul")).toBe("Bulleted list");
    expect(first("ol")).toBe("Numbered list");
    expect(first("snippet")).toBe("Code block");
    expect(first("paragraph")).toBe("Text");
  });

  it("ignores case and stray spaces", () => {
    expect(BLOCKS.filter((block) => block.matches("  TODO "))[0]?.label).toBe("To-do list");
  });

  it("matches nothing when nothing matches, so the menu closes", () => {
    expect(BLOCKS.filter((block) => block.matches("zebra"))).toHaveLength(0);
  });

  it("gives every block a distinct name and key", () => {
    expect(new Set(BLOCKS.map((block) => block.key)).size).toBe(BLOCKS.length);
    expect(new Set(BLOCKS.map((block) => block.command)).size).toBe(BLOCKS.length);
    for (const block of BLOCKS) {
      expect(block.hint).not.toBe("");
    }
  });
});
