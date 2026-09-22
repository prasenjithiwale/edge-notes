import { beforeEach, describe, expect, it } from "vitest";
import { $getRoot, $isParagraphNode, createEditor, type LexicalEditor } from "lexical";
import { ListItemNode, ListNode } from "@lexical/list";
import { LinkNode, AutoLinkNode } from "@lexical/link";
import { HeadingNode } from "@lexical/rich-text";

import { CodeNode } from "./CodeNode";
import { ImageNode } from "./ImageNode";
import { $hintedKey } from "./plugins";
import { $setFromMarkdown } from "./markdown";

let editor: LexicalEditor;

beforeEach(() => {
  editor = createEditor({
    namespace: "test",
    nodes: [HeadingNode, ListNode, ListItemNode, LinkNode, AutoLinkNode, CodeNode, ImageNode],
    onError: (error) => {
      throw error;
    },
  });
});

/** Put a note in and drop the caret on the line at `index`. */
function caretOn(markdown: string, index: number): void {
  editor.update(
    () => {
      $setFromMarkdown(markdown);
    },
    { discrete: true },
  );
  editor.update(
    () => {
      const block = $getRoot().getChildren()[index];
      block?.selectEnd();
    },
    { discrete: true },
  );
}

function hinted(): boolean {
  return editor.getEditorState().read(() => {
    const key = $hintedKey();
    if (key === null) {
      return false;
    }
    // Whatever it points at had better be the empty paragraph it claims.
    const block = $getRoot()
      .getChildren()
      .find((child) => child.getKey() === key);
    return $isParagraphNode(block) && block.getChildrenSize() === 0;
  });
}

/**
 * The hint says what `/` does, so it belongs on a line that is waiting to be
 * something — and nowhere else. A hint on a line with words on it would be
 * drawn straight through them.
 */
describe("the empty-line hint", () => {
  it("is on an empty line with the caret on it", () => {
    caretOn("Shopping\n\n- milk", 1);
    expect(hinted()).toBe(true);
  });

  it("is not on a line with anything on it", () => {
    caretOn("Shopping\n\n- milk", 0);
    expect(hinted()).toBe(false);
  });

  it("is not on an empty line the caret is not on", () => {
    caretOn("Shopping\n\n- milk", 2);
    expect(hinted()).toBe(false);
  });

  it("stays off an empty note, which has the editor's own placeholder", () => {
    caretOn("", 0);
    expect(hinted()).toBe(false);
  });

  it("stays off an empty list item, which is a line that is already something", () => {
    caretOn("- milk\n- ", 1);
    expect(hinted()).toBe(false);
  });
});
