import { beforeEach, describe, expect, it } from "vitest";
import {
  $getRoot,
  $isElementNode,
  $isTextNode,
  createEditor,
  type LexicalEditor,
} from "lexical";
import { registerRichText } from "@lexical/rich-text";
import { ListItemNode, ListNode, registerCheckList, registerList } from "@lexical/list";
import { AutoLinkNode, LinkNode } from "@lexical/link";

import { CodeNode } from "./CodeNode";
import { HeadingNode } from "@lexical/rich-text";

import { EDITOR_NODES } from "./config";
import { $setFromMarkdown, $toMarkdown } from "./markdown";
import { isActive, runCommand, type FormatCommand, type ToolbarState } from "./toolbar";

let editor: LexicalEditor;

const IDLE: ToolbarState = {
  bold: false,
  italic: false,
  strike: false,
  code: false,
  list: null,
  heading: 0,
};

beforeEach(() => {
  editor = createEditor({
    namespace: "test",
    nodes: [...EDITOR_NODES],
    onError: (error) => {
      throw error;
    },
  });
  // The commands the toolbar dispatches are registered by the plugins in the
  // running app; a headless editor has to be given them by hand.
  registerRichText(editor);
  registerList(editor);
  registerCheckList(editor);
});

/** Put a note in the editor and select the whole of its first line. */
function withSelection(markdown: string): void {
  editor.update(
    () => {
      $setFromMarkdown(markdown);
    },
    { discrete: true },
  );
  editor.update(
    () => {
      const first = $getRoot().getFirstChild();
      const text = $isElementNode(first) ? first.getFirstChild() : null;
      if ($isTextNode(text)) {
        text.select(0, text.getTextContentSize());
      } else {
        $getRoot().selectStart();
      }
    },
    { discrete: true },
  );
}

function markdown(): string {
  return editor.getEditorState().read($toMarkdown);
}

/**
 * Dispatching a command schedules an update; a headless editor has no frame to
 * commit it on, so an empty discrete update flushes what is pending.
 */
function run(command: FormatCommand, state: ToolbarState = IDLE, lang = ""): void {
  runCommand(editor, command, state, lang);
  editor.update(() => undefined, { discrete: true });
}

describe("the marks", () => {
  const cases: [FormatCommand, string][] = [
    ["bold", "**hello**"],
    ["italic", "_hello_"],
    ["strike", "~~hello~~"],
    ["code", "`hello`"],
  ];

  for (const [command, expected] of cases) {
    it(`${command} marks the selection, and marks it back off`, () => {
      withSelection("hello");
      run(command);
      expect(markdown()).toBe(expected);
      run(command);
      expect(markdown()).toBe("hello");
    });
  }

  it("keeps two marks on one stretch of text", () => {
    withSelection("hello");
    run("bold");
    run("italic");
    // Nested, not repeated: the serialiser has to fold the shared mark outwards.
    expect(markdown()).toBe("**_hello_**");
  });
});

describe("the lists", () => {
  const cases: [FormatCommand, string][] = [
    ["bullet", "- milk"],
    ["ordered", "1. milk"],
    ["task", "- [ ] milk"],
  ];

  for (const [command, expected] of cases) {
    it(`${command} makes the line a list item`, () => {
      withSelection("milk");
      run(command);
      expect(markdown()).toBe(expected);
    });
  }

  it("turns a list off when its own button is pressed again", () => {
    withSelection("milk");
    run("bullet");
    expect(markdown()).toBe("- milk");
    // The toolbar reports what the caret is in; pressing the lit button is a
    // toggle, which is what lighting it promised.
    run("bullet", { ...IDLE, list: "bullet" });
    expect(markdown()).toBe("milk");
  });

  it("changes one kind of list into another", () => {
    withSelection("milk");
    run("bullet");
    run("ordered", { ...IDLE, list: "bullet" });
    expect(markdown()).toBe("1. milk");
  });
});

describe("the code block", () => {
  it("wraps what was selected, in the language asked for", () => {
    withSelection("const a = 1");
    run("codeblock", IDLE, "javascript");
    // With the empty paragraph after it, which is what gives the note somewhere
    // to carry on: a block at the very end would otherwise be a dead end.
    expect(markdown()).toBe("```javascript\nconst a = 1\n```\n");
  });

  it("opens an empty block when nothing is selected", () => {
    editor.update(
      () => {
        $setFromMarkdown("");
        $getRoot().selectStart();
      },
      { discrete: true },
    );
    run("codeblock", IDLE, "python");
    expect(markdown()).toBe("```python\n\n```\n");
  });

  /** A decorator at the end of a note would otherwise leave nowhere to type. */
  it("leaves a paragraph after a block at the end of the note", () => {
    withSelection("x = 1");
    run("codeblock", IDLE, "python");
    editor.getEditorState().read(() => {
      const last = $getRoot().getLastChild();
      expect(last?.getType()).toBe("paragraph");
    });
  });
});

describe("turning a line back into a paragraph", () => {
  it("takes a list item out of its list", () => {
    withSelection("milk");
    run("bullet");
    expect(markdown()).toBe("- milk");

    run("text", { ...IDLE, list: "bullet" });
    expect(markdown()).toBe("milk");
  });

  it("leaves a line that is already a paragraph alone", () => {
    withSelection("just a line");
    run("text");
    expect(markdown()).toBe("just a line");
  });
});

describe("what the toolbar lights", () => {
  it("is on for the mark or list the caret is in, and never for the code block", () => {
    const state: ToolbarState = { ...IDLE, bold: true, list: "check" };
    expect(isActive("bold", state)).toBe(true);
    expect(isActive("italic", state)).toBe(false);
    expect(isActive("task", state)).toBe(true);
    expect(isActive("bullet", state)).toBe(false);
    expect(isActive("codeblock", state)).toBe(false);
    // "Text" is on when the line is not a list, which is what it makes it.
    expect(isActive("text", state)).toBe(false);
    expect(isActive("text", IDLE)).toBe(true);
  });
});

describe("the node list", () => {
  it("is exactly what the dialect can write back", () => {
    expect(EDITOR_NODES).toEqual([
      HeadingNode,
      ListNode,
      ListItemNode,
      LinkNode,
      AutoLinkNode,
      CodeNode,
    ]);
  });
});
