import { describe, expect, it } from "vitest";

import {
  CHECKLIST_LINES,
  cardPreview,
  continueList,
  parseInline,
  parseLine,
  plainText,
  toggleInline,
  toggleList,
  toggleTaskLine,
  type TextEdit,
  type TextState,
} from "./markdown";

/**
 * Write a text state with `|` for a caret, or `«` and `»` around a selection, so
 * a test reads like the field it describes.
 */
function field(marked: string): TextState {
  const caret = marked.indexOf("|");
  if (caret !== -1) {
    return {
      value: marked.slice(0, caret) + marked.slice(caret + 1),
      selectionStart: caret,
      selectionEnd: caret,
    };
  }
  const start = marked.indexOf("«");
  const end = marked.indexOf("»") - 1;
  const value = marked.replace("«", "").replace("»", "");
  return { value, selectionStart: start, selectionEnd: end };
}

/** Apply an edit and render the result in the same notation. */
function after(state: TextState, edit: TextEdit | null): string {
  if (edit === null) {
    return "(no change)";
  }
  const value = state.value.slice(0, edit.start) + edit.text + state.value.slice(edit.end);
  if (edit.selectionStart === edit.selectionEnd) {
    return `${value.slice(0, edit.selectionStart)}|${value.slice(edit.selectionStart)}`;
  }
  return `${value.slice(0, edit.selectionStart)}«${value.slice(
    edit.selectionStart,
    edit.selectionEnd,
  )}»${value.slice(edit.selectionEnd)}`;
}

describe("parseLine", () => {
  it("reads a paragraph as the whole line", () => {
    expect(parseLine("Just text")).toMatchObject({ kind: "paragraph", text: "Just text" });
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

describe("toggleInline", () => {
  it("wraps the selection and keeps the text selected", () => {
    const state = field("say «hello» there");
    expect(after(state, toggleInline(state, "**"))).toBe("say **«hello»** there");
  });

  it("unwraps a selection that sits inside a pair", () => {
    const state = field("say **«hello»** there");
    expect(after(state, toggleInline(state, "**"))).toBe("say «hello» there");
  });

  it("unwraps a selection that includes its markers", () => {
    const state = field("say «_hello_» there");
    expect(after(state, toggleInline(state, "_"))).toBe("say «hello» there");
  });

  it("leaves selected whitespace outside the markers", () => {
    const state = field("say« hello »there");
    expect(after(state, toggleInline(state, "~~"))).toBe("say ~~«hello»~~ there");
  });

  it("inserts an empty pair at a caret, and removes it again", () => {
    const state = field("a |b");
    const inserted = after(state, toggleInline(state, "**"));
    expect(inserted).toBe("a **|**b");
    const again = field(inserted);
    expect(after(again, toggleInline(again, "**"))).toBe("a |b");
  });

  it("wraps each line separately, after its list prefix", () => {
    const state = field("«- [ ] milk\n\n2. eggs»");
    expect(after(state, toggleInline(state, "**"))).toBe("«- [ ] **milk**\n\n2. **eggs**»");
    const again = field("«- [ ] **milk**\n\n2. **eggs**»");
    expect(after(again, toggleInline(again, "**"))).toBe("«- [ ] milk\n\n2. eggs»");
  });

  it("does nothing for a whitespace-only selection", () => {
    expect(toggleInline(field("a«   »b"), "**")).toBeNull();
  });
});

describe("toggleList", () => {
  it("makes the caret's line a bullet and keeps the caret in its text", () => {
    const state = field("mi|lk");
    expect(after(state, toggleList(state, "bullet"))).toBe("- mi|lk");
  });

  it("removes the prefix when the line already is that kind", () => {
    const state = field("- mi|lk");
    expect(after(state, toggleList(state, "bullet"))).toBe("mi|lk");
  });

  it("starts an item on an empty line", () => {
    const state = field("Title\n|");
    expect(after(state, toggleList(state, "task"))).toBe("Title\n- [ ] |");
  });

  it("converts every selected line and numbers them", () => {
    const state = field("«milk\n- eggs\n\n- [x] rice»");
    expect(after(state, toggleList(state, "ordered"))).toBe("«1. milk\n2. eggs\n\n3. rice»");
  });

  it("keeps a task's tick when other lines become tasks", () => {
    const state = field("«- [x] done\ntodo»");
    expect(after(state, toggleList(state, "task"))).toBe("«- [x] done\n- [ ] todo»");
  });

  it("continues numbering from an item directly above", () => {
    const state = field("1. one\n2. two\nthr|ee");
    expect(after(state, toggleList(state, "ordered"))).toBe("1. one\n2. two\n3. thr|ee");
  });

  it("ignores a line the selection only touches at its start", () => {
    const state = field("«one\n»two");
    expect(after(state, toggleList(state, "bullet"))).toBe("«- one»\ntwo");
  });

  it("keeps indentation", () => {
    const state = field("  ne|sted");
    expect(after(state, toggleList(state, "bullet"))).toBe("  - ne|sted");
  });
});

describe("continueList", () => {
  it("starts the next bullet with the same marker", () => {
    const state = field("* milk|");
    expect(after(state, continueList(state))).toBe("* milk\n* |");
  });

  it("numbers the next item", () => {
    const state = field("9) nine|");
    expect(after(state, continueList(state))).toBe("9) nine\n10) |");
  });

  it("starts an unticked task after a ticked one, keeping indentation", () => {
    const state = field("  - [x] done|");
    expect(after(state, continueList(state))).toBe("  - [x] done\n  - [ ] |");
  });

  it("splits an item at the caret", () => {
    const state = field("- milk| eggs");
    expect(after(state, continueList(state))).toBe("- milk\n- | eggs");
  });

  it("ends the list on an empty item", () => {
    const state = field("- milk\n- |");
    expect(after(state, continueList(state))).toBe("- milk\n|");
  });

  it("leaves Enter alone outside a list, in a prefix, or with a selection", () => {
    expect(continueList(field("plain|"))).toBeNull();
    expect(continueList(field("-| milk"))).toBeNull();
    expect(continueList(field("- «mi»lk"))).toBeNull();
  });
});
