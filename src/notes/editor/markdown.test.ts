import { beforeEach, describe, expect, it } from "vitest";
import { $getRoot, createEditor, type LexicalEditor } from "lexical";
import { $isListNode, ListItemNode, ListNode } from "@lexical/list";
import { LinkNode } from "@lexical/link";
import { HeadingNode } from "@lexical/rich-text";

import { CodeNode } from "./CodeNode";
import { ImageNode } from "./ImageNode";
import { $setFromMarkdown, $toMarkdown } from "./markdown";

let editor: LexicalEditor;

beforeEach(() => {
  editor = createEditor({
    namespace: "test",
    nodes: [HeadingNode, ListNode, ListItemNode, LinkNode, CodeNode, ImageNode],
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
    // Idea 17. The note holds the link and nothing else, so the round trip is
    // the same promise as for every other shape — and a bracket that is not an
    // image has to stay the text it was.
    [
      "a pasted image",
      "before\n![](ledge://localhost/0199a000-0000-7000-8000-000000000001.png)\nafter",
    ],
    [
      "an image with alt text",
      "![the graph](ledge://localhost/0199a000-0000-7000-8000-000000000002.jpg)",
    ],
    // The dialect's one addition to the image syntax, and the shapes that must
    // not be read as a width: a caption with a pipe in it, and a pipe with
    // something that is not a number after it.
    [
      "an image with a width",
      "![|320](ledge://localhost/0199a000-0000-7000-8000-000000000003.png)",
    ],
    [
      "an image with alt text and a width",
      "![the graph|480](ledge://localhost/0199a000-0000-7000-8000-000000000004.png)",
    ],
    [
      "a caption that has a pipe in it",
      "![before | after](ledge://localhost/0199a000-0000-7000-8000-000000000005.png)",
    ],
    [
      "a pipe with no number after it",
      "![alt|wide](ledge://localhost/0199a000-0000-7000-8000-000000000006.png)",
    ],
    ["something that only looks like an image", "not ![an image really"],
    ["a bang before a bracket", "wow! [not a link] here"],
    // The three levels the dialect writes, and the shapes that look like
    // headings and are not: a fourth hash, no space after it, and an indented
    // one. Each of those has to come back as the text somebody typed.
    ["a heading", "# Release runbook"],
    ["the second and third levels", "## Before the tag\n### Checks"],
    ["marks inside a heading", "## A **bold** word and `code`"],
    ["a heading above its paragraph", "# Title\n\nWhat it is about"],
    ["a fourth hash, which is not a heading", "#### Not a heading"],
    ["a hash with no space", "#NoSpace"],
    ["an indented hash", "  # indented"],
    [
      "everything at once",
      "# Title\n**Bold**\n- [ ] do it\n\n```json\n{}\n```\n### End",
    ],
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
