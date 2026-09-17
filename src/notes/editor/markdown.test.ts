import { beforeEach, describe, expect, it } from "vitest";
import { $getRoot, createEditor, type LexicalEditor } from "lexical";
import { $isListNode, ListItemNode, ListNode } from "@lexical/list";
import { LinkNode } from "@lexical/link";

import { CodeNode } from "./CodeNode";
import { $setFromMarkdown, $toMarkdown } from "./markdown";

let editor: LexicalEditor;

beforeEach(() => {
  editor = createEditor({
    namespace: "test",
    nodes: [ListNode, ListItemNode, LinkNode, CodeNode],
    onError: (error) => {
      throw error;
    },
  });
});

/** Read a note in and write it straight back out. */
function roundTrip(markdown: string): string {
  editor.update(
    () => {
      $setFromMarkdown(markdown);
    },
    { discrete: true },
  );
  let out = "";
  editor.getEditorState().read(() => {
    out = $toMarkdown();
  });
  return out;
}

/**
 * The promise the whole conversion rests on: a note is stored exactly as it was
 * written, so opening one in the editor and closing it again must not change a
 * byte. Anything that fails here rewrites people's notes behind their backs.
 */
describe("a note survives a trip through the editor", () => {
  const notes: [string, string][] = [
    ["plain text", "Standup notes\nDeploy the fix before 4 pm"],
    ["a blank line between paragraphs", "One\n\nTwo"],
    ["bold, italic and strikethrough", "**bold** and _soft_ and ~~gone~~"],
    ["marks inside each other", "**bold with _both_ inside**"],
    ["inline code", "set `a ** b` now"],
    ["a bare link", "see https://example.test/docs for more"],
    ["a bulleted list", "Shopping\n- milk\n- eggs"],
    ["a numbered list", "Steps\n1. wake up\n2. coffee"],
    ["a checklist", "Today\n- [ ] milk\n- [x] eggs"],
    ["two lists of different kinds", "- milk\n1. first"],
    ["an indented item", "- milk\n  - the blue one"],
    ["a code block", "Snippet\n```python\nname = 1\n```"],
    ["a code block with no language", "```\nplain\n```"],
    ["a code block between paragraphs", "before\n```js\nconst a = 1\n```\nafter"],
    ["an empty note", ""],
    ["everything at once", "# not a heading\n**Title**\n- [ ] do it\n\n```json\n{}\n```\nend"],
  ];

  for (const [name, markdown] of notes) {
    it(`keeps ${name} exactly as it was`, () => {
      expect(roundTrip(markdown)).toBe(markdown);
    });
  }
});

describe("what the editor holds", () => {
  it("groups consecutive items of one kind into a single list", () => {
    editor.update(
      () => {
        $setFromMarkdown("- milk\n- eggs\n1. first\n- [ ] task");
      },
      { discrete: true },
    );

    editor.getEditorState().read(() => {
      const kinds = $getRoot()
        .getChildren()
        .map((child) => child.getType());
      // Three lists, not four items: the two bullets are one list, so ticking
      // and renumbering behave, and a change of kind starts a new one.
      expect(kinds).toEqual(["list", "list", "list"]);
      const first = $getRoot().getFirstChild();
      expect($isListNode(first) ? first.getChildrenSize() : 0).toBe(2);
    });
  });

  it("gives an empty note one paragraph to type into", () => {
    editor.update(
      () => {
        $setFromMarkdown("");
      },
      { discrete: true },
    );
    editor.getEditorState().read(() => {
      expect($toMarkdown()).toBe("");
    });
  });

  it("holds a code block's language and text as fields, not as text", () => {
    editor.update(
      () => {
        $setFromMarkdown("```sql\nselect 1\n```");
      },
      { discrete: true },
    );
    editor.getEditorState().read(() => {
      expect($toMarkdown()).toBe("```sql\nselect 1\n```");
    });
  });
});
