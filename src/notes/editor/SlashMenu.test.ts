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
      "bold",
      "italic",
      "strike",
      "code",
    ]);
  });

  it("keeps the blocks together and the marks together, in that order", () => {
    // The menu draws a heading wherever the kind changes, so an interleaved
    // list would draw several.
    const groups = BLOCKS.map((block) => block.group);
    expect(groups.indexOf("mark")).toBe(groups.lastIndexOf("block") + 1);
    expect(new Set(groups)).toEqual(new Set(["block", "mark"]));
  });

  it("shows the key for everything that has one", () => {
    // "Text" is the only command with no shortcut of its own.
    expect(BLOCKS.filter((block) => block.shortcut === null).map((b) => b.command)).toEqual([
      "text",
    ]);
    expect(BLOCKS.find((block) => block.command === "bold")?.shortcut).toMatch(/B$/);
  });

  it("shows everything for a bare slash, so it can be browsed", () => {
    expect(BLOCKS.filter((block) => block.matches(""))).toHaveLength(BLOCKS.length);
  });

  it("finds a block by its name", () => {
    const named = (query: string) =>
      BLOCKS.filter((block) => block.matches(query)).map((block) => block.label);
    expect(named("bulleted")).toEqual(["Bulleted list"]);
    expect(named("number")).toEqual(["Numbered list"]);
    expect(named("strikethrough")).toEqual(["Strikethrough"]);
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
    expect(first("strong")).toBe("Bold");
    expect(first("em")).toBe("Italic");
    expect(first("mono")).toBe("Code");
  });

  /** Two different things are called code; both should be findable. */
  it("offers the block and the mark when a query matches both", () => {
    expect(BLOCKS.filter((block) => block.matches("code")).map((block) => block.label)).toEqual([
      "Code block",
      "Code",
    ]);
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
