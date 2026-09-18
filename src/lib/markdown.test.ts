import { describe, expect, it } from "vitest";

import {
  CHECKLIST_LINES,
  cardPreview,
  parseBlocks,
  parseInline,
  parseLine,
  plainText,
  toggleTaskLine,
} from "./markdown";

describe("parseLine", () => {
  it("reads a paragraph as the whole line", () => {
    expect(parseLine("Just text")).toMatchObject({ kind: "paragraph", text: "Just text" });
  });

  it("reads the three heading levels, with the level on the line", () => {
    expect(parseLine("# Title")).toMatchObject({ kind: "heading", level: 1, text: "Title" });
    expect(parseLine("## Section")).toMatchObject({
      kind: "heading",
      level: 2,
      text: "Section",
    });
    expect(parseLine("### Smaller")).toMatchObject({ kind: "heading", level: 3 });
    // The prefix is what has to be written back to reproduce the line.
    expect(parseLine("## Section").prefix).toBe("## ");
  });

  /**
   * Three levels is what the dialect can write, so a fourth hash is text. So is
   * a hash with nothing after it, and an indented one: a heading inside a list
   * is not something this dialect can express.
   */
  it("leaves anything it cannot write back as a paragraph", () => {
    for (const line of ["#### Four", "#NoSpace", "  # indented", "#", "text # middle"]) {
      expect(parseLine(line), line).toMatchObject({ kind: "paragraph", level: 0, text: line });
    }
  });

  it("gives every other kind of line a level of zero", () => {
    for (const line of ["- milk", "1. first", "- [ ] task", "plain"]) {
      expect(parseLine(line).level, line).toBe(0);
    }
  });

  it("reads bullets with any of the three markers", () => {
    for (const marker of ["-", "*", "+"]) {
      expect(parseLine(`${marker} milk`)).toMatchObject({
        kind: "bullet",
        text: "milk",
        marker,
      });
    }
  });

  it("reads numbered items and keeps the number as written", () => {
    expect(parseLine("3. eggs")).toMatchObject({ kind: "ordered", number: 3, text: "eggs" });
    expect(parseLine("12) rice")).toMatchObject({ kind: "ordered", number: 12, marker: ")" });
  });

  it("reads tasks, ticked or not", () => {
    expect(parseLine("- [ ] call Sam")).toMatchObject({ kind: "task", checked: false });
    expect(parseLine("- [x] call Sam")).toMatchObject({ kind: "task", checked: true });
    expect(parseLine("* [X] done")).toMatchObject({ kind: "task", checked: true });
    expect(parseLine("- [ ]")).toMatchObject({ kind: "task", text: "" });
  });

  it("keeps indentation in the prefix", () => {
    expect(parseLine("  - nested")).toMatchObject({ indent: "  ", prefix: "  - " });
  });

  it("does not mistake emphasis or a hyphen for a bullet", () => {
    expect(parseLine("*emphasis* here").kind).toBe("paragraph");
    expect(parseLine("-5 degrees").kind).toBe("paragraph");
    expect(parseLine("- [link] text").kind).toBe("bullet");
  });
});

describe("parseInline", () => {
  it("leaves plain text alone", () => {
    expect(parseInline("plain")).toEqual([{ kind: "text", text: "plain" }]);
  });

  it("reads bold, italic and strikethrough", () => {
    expect(parseInline("a **b** _c_ *d* ~~e~~")).toEqual([
      { kind: "text", text: "a " },
      { kind: "bold", children: [{ kind: "text", text: "b" }] },
      { kind: "text", text: " " },
      { kind: "italic", children: [{ kind: "text", text: "c" }] },
      { kind: "text", text: " " },
      { kind: "italic", children: [{ kind: "text", text: "d" }] },
      { kind: "text", text: " " },
      { kind: "strike", children: [{ kind: "text", text: "e" }] },
    ]);
  });

  it("nests", () => {
    expect(parseInline("**bold _and italic_**")).toEqual([
      {
        kind: "bold",
        children: [
          { kind: "text", text: "bold " },
          { kind: "italic", children: [{ kind: "text", text: "and italic" }] },
        ],
      },
    ]);
  });

  it("shows unmatched and space-padded markers literally", () => {
    expect(plainText(parseInline("**not closed"))).toBe("**not closed");
    expect(parseInline("2 * 3 * 4")).toEqual([{ kind: "text", text: "2 * 3 * 4" }]);
    expect(parseInline("** loose **")).toEqual([{ kind: "text", text: "** loose **" }]);
  });

  it("does not italicise snake_case words", () => {
    expect(parseInline("some_long_name")).toEqual([
      { kind: "text", text: "some_long_name" },
    ]);
  });

  it("finds bare links and leaves sentence punctuation outside them", () => {
    expect(parseInline("see https://example.com/a_b.")).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", url: "https://example.com/a_b" },
      { kind: "text", text: "." },
    ]);
    expect(parseInline("(http://x.io/path)")).toEqual([
      { kind: "text", text: "(" },
      { kind: "link", url: "http://x.io/path" },
      { kind: "text", text: ")" },
    ]);
    expect(parseInline("https://en.wikipedia.org/wiki/Tea_(meal)")).toEqual([
      { kind: "link", url: "https://en.wikipedia.org/wiki/Tea_(meal)" },
    ]);
  });

  it("finds a link inside formatting", () => {
    expect(parseInline("**https://example.com**")).toEqual([
      { kind: "bold", children: [{ kind: "link", url: "https://example.com" }] },
    ]);
  });

  it("does not treat a bare scheme or a mid-word match as a link", () => {
    expect(parseInline("https://")).toEqual([{ kind: "text", text: "https://" }]);
    expect(parseInline("xhttps://a.com")).toEqual([
      { kind: "text", text: "xhttps://a.com" },
    ]);
  });

  it("stays fast on a long line of unmatched markers", () => {
    // Every marker can open (text follows it) and none can close (a space
    // precedes every later one), which is the worst case for the closer search.
    const line = "**a _b ~~c *d ".repeat(3_000);
    const started = performance.now();
    expect(plainText(parseInline(line))).toBe(line);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("inline code", () => {
  it("takes its contents literally, markers and all", () => {
    const nodes = parseInline("run `a ** b` now");
    expect(nodes).toEqual([
      { kind: "text", text: "run " },
      { kind: "code", text: "a ** b" },
      { kind: "text", text: " now" },
    ]);
  });

  it("is text when the backtick never closes, or closes on itself", () => {
    expect(parseInline("a ` b")).toEqual([{ kind: "text", text: "a ` b" }]);
    expect(parseInline("a `` b")).toEqual([{ kind: "text", text: "a `` b" }]);
  });

  it("reads as its own text in an accessible name", () => {
    expect(plainText(parseInline("set `x` to **2**"))).toBe("set x to 2");
  });
});

describe("cardPreview", () => {
  it("titles the card with the first non-empty line, trimmed", () => {
    const preview = cardPreview("\n\n   Groceries   \nMilk");
    expect(preview.title?.text).toBe("Groceries");
    expect(preview.title?.index).toBe(2);
  });

  it("is empty for an empty note", () => {
    expect(cardPreview("  \n ")).toEqual({ title: null, layout: "flow", body: [], hidden: 0 });
  });

  it("flows plain paragraphs as before formatting existed", () => {
    const preview = cardPreview("Title\nMilk, eggs\n\ncoffee");
    expect(preview.layout).toBe("flow");
    expect(preview.body.map((line) => line.text)).toEqual(["Milk, eggs", "coffee"]);
  });

  it("gives list items their own rows, two of them", () => {
    const preview = cardPreview("Title\n- one\n- two\n- three");
    expect(preview.layout).toBe("rows");
    expect(preview.body.map((line) => line.text)).toEqual(["one", "two"]);
    expect(preview.hidden).toBe(1);
  });

  it("shows more rows for a checklist, so items can be ticked from the card", () => {
    const content = ["Groceries", ...Array.from({ length: 8 }, (_, i) => `- [ ] item ${String(i)}`)].join("\n");
    const preview = cardPreview(content);
    expect(preview.body).toHaveLength(CHECKLIST_LINES);
    expect(preview.hidden).toBe(8 - CHECKLIST_LINES);
    expect(preview.body[0]?.index).toBe(1);
  });

  it("skips empty list items", () => {
    expect(cardPreview("Title\n- [ ] \n- [ ] real").body.map((l) => l.text)).toEqual(["real"]);
  });
});

describe("a card with code in it", () => {
  const note = ["Snippet", "```js", "const a = 1;", "```", "after"].join("\n");

  it("previews the code without its fences, and says the line is code", () => {
    const preview = cardPreview(note);
    expect(preview.title?.text).toBe("Snippet");
    expect(preview.layout).toBe("rows");
    expect(preview.body.map((line) => [line.text, line.code])).toEqual([
      ["const a = 1;", true],
      ["after", false],
    ]);
  });

  it("keeps the indentation of a code line, which is part of the code", () => {
    const indented = ["```py", "def f():", "    return 1", "```"].join("\n");
    expect(cardPreview(indented).body.map((line) => line.text)).toEqual(["    return 1"]);
  });

  it("gives every line the index it has in the note, fences counted", () => {
    expect(cardPreview(note).body.map((line) => line.index)).toEqual([2, 4]);
  });
});

describe("toggleTaskLine", () => {
  it("ticks and unticks the named line only", () => {
    const content = "Groceries\n- [ ] milk\n- [x] eggs";
    expect(toggleTaskLine(content, 1)).toBe("Groceries\n- [x] milk\n- [x] eggs");
    expect(toggleTaskLine(content, 2)).toBe("Groceries\n- [ ] milk\n- [ ] eggs");
  });

  it("refuses a line that is not a task", () => {
    expect(toggleTaskLine("Groceries\n- milk", 1)).toBeNull();
    expect(toggleTaskLine("Groceries", 5)).toBeNull();
  });
});

describe("fenced code blocks", () => {
  const note = ["Setup", "```python", "x = 1", "", "print(x)", "```", "done"].join("\n");

  it("collapses a fenced run into one block, and keeps the line numbers", () => {
    const blocks = parseBlocks(note);
    expect(blocks.map((block) => block.kind)).toEqual(["line", "code", "line"]);

    const [, code] = blocks;
    expect(code).toMatchObject({
      kind: "code",
      lang: "python",
      code: "x = 1\n\nprint(x)",
      from: 1,
      to: 6,
      closed: true,
    });
    // The line after it is still line 6 of the note, so a tick finds its own row.
    expect(blocks[2]).toMatchObject({ kind: "line", index: 6 });
  });

  it("treats a fence with no closer as a block that runs to the end", () => {
    const blocks = parseBlocks("```js\nconst a = 1");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "code", code: "const a = 1", closed: false });
  });

  it("takes the language exactly as it was written", () => {
    expect(parseBlocks("```JSON\n{}\n```")[0]).toMatchObject({ lang: "JSON" });
    expect(parseBlocks("```\nplain\n```")[0]).toMatchObject({ lang: "" });
  });

  it("does not see a fence in the middle of a line", () => {
    expect(parseBlocks("see ```js here").map((block) => block.kind)).toEqual(["line"]);
  });

});





