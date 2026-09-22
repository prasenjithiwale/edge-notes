/**
 * What the formatting toolbar shows and what its buttons do.
 *
 * The toolbar is a *state*, not a set of actions: in a rich editor a button is
 * lit when the caret is already in bold, which is how anyone who has used a word
 * processor expects to be told what they are typing. That is the whole reason
 * this file exists — the old editor's buttons were write-only.
 */
import { useEffect, useState } from "react";
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
  $isListNode,
  $isListItemNode,
  type ListType,
} from "@lexical/list";
import {
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  $createParagraphNode,
  FORMAT_TEXT_COMMAND,
  type LexicalEditor,
} from "lexical";
import {
  $createHeadingNode,
  $isHeadingNode,
  type HeadingTagType,
} from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";

import { $createCodeNode } from "./CodeNode";
import { insertImage } from "./ImageNode";
import { pickImages } from "./pickImage";
import { $createTableNode } from "./TableNode";

export type FormatCommand =
  /** Back to a plain paragraph: what the slash menu calls "Text". */
  | "text"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "bullet"
  | "ordered"
  | "task"
  | "codeblock"
  /**
   * Ask for an image file and put it in the note. The only command that opens a
   * window of its own, which is why it is also the only one that tells the dock
   * a picker is up.
   */
  | "image"
  /** Put an empty table in the note; the grid takes it from there. */
  | "table";

/** Which of the toolbar's marks and list kinds the caret is currently inside. */
export interface ToolbarState {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  list: ListType | null;
  /** 1, 2 or 3 when the caret is in a heading; 0 when it is not. */
  heading: number;
}

const IDLE: ToolbarState = {
  bold: false,
  italic: false,
  strike: false,
  code: false,
  list: null,
  heading: 0,
};

/** The three the dialect can write, and the tag Lexical knows each by. */
const HEADING_LEVEL: Record<"heading1" | "heading2" | "heading3", 1 | 2 | 3> = {
  heading1: 1,
  heading2: 2,
  heading3: 3,
};

const LIST_FOR: Record<"bullet" | "ordered" | "task", ListType> = {
  bullet: "bullet",
  ordered: "number",
  task: "check",
};

function same(a: ToolbarState, b: ToolbarState): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.strike === b.strike &&
    a.code === b.code &&
    a.list === b.list &&
    a.heading === b.heading
  );
}

/**
 * What the caret is inside, as the toolbar draws it.
 *
 * The listener fires on *every* editor update — each keystroke, each caret
 * move — so it must answer with the same object when nothing it reports has
 * changed. Handing back a fresh object each time re-renders the whole editor on
 * every keystroke, and anything in that render that builds a new array or object
 * for a plugin then re-registers the plugin, which is itself an update. That is
 * a loop, and it froze the app rather than failing.
 */
export function useToolbarState(editor: LexicalEditor): ToolbarState {
  const [state, setState] = useState<ToolbarState>(IDLE);

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) {
            setState((previous) => (same(previous, IDLE) ? previous : IDLE));
            return;
          }
          const node = selection.anchor.getNode();
          const item = $isListItemNode(node) ? node : node.getParent();
          const list = $isListItemNode(item) ? item.getParent() : null;
          const block = $isHeadingNode(node) ? node : node.getParent();
          const next: ToolbarState = {
            bold: selection.hasFormat("bold"),
            italic: selection.hasFormat("italic"),
            strike: selection.hasFormat("strikethrough"),
            code: selection.hasFormat("code"),
            list: $isListNode(list) ? list.getListType() : null,
            heading: $isHeadingNode(block) ? Number(block.getTag().slice(1)) : 0,
          };
          setState((previous) => (same(previous, next) ? previous : next));
        });
      }),
    [editor],
  );

  return state;
}

/** Whether the caret is already inside what this button applies. */
export function isActive(command: FormatCommand, state: ToolbarState): boolean {
  switch (command) {
    // Adding a picture or a table is not a state the caret can be in.
    case "image":
    case "table":
      return false;
    case "text":
      return state.list === null && state.heading === 0;
    case "heading1":
    case "heading2":
    case "heading3":
      return state.heading === HEADING_LEVEL[command];
    case "bold":
      return state.bold;
    case "italic":
      return state.italic;
    case "strike":
      return state.strike;
    case "code":
      return state.code;
    case "bullet":
    case "ordered":
    case "task":
      return state.list === LIST_FOR[command];
    case "codeblock":
      // It inserts rather than marks up, so it is never "on".
      return false;
  }
}

/**
 * Run a toolbar command. A list button pressed while the caret is already in
 * that kind of list turns it off, which is what a toggle means and what the
 * button's lit state has just promised.
 */
export function runCommand(
  editor: LexicalEditor,
  command: FormatCommand,
  state: ToolbarState,
  lang = "",
): void {
  switch (command) {
    case "table":
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return;
        }
        const table = $createTableNode();
        $insertNodes([table]);
        // Somewhere to carry on after it, exactly as the code block does: a
        // decorator at the end of a note leaves nowhere to type.
        if (table.getNextSibling() === null) {
          table.insertAfter($createParagraphNode());
        }
      });
      return;
    case "image":
      void pickImages().then((names) => {
        for (const name of names) {
          insertImage(editor, name);
        }
      });
      return;
    case "text":
      // Whatever kind of list this line is in, it stops being one. A line that
      // is already a paragraph is left alone, which is what `REMOVE_LIST` does.
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          // A heading is an element, not a mark, so going back to plain text is
          // swapping the block rather than turning something off.
          $setBlocksType(selection, () => $createParagraphNode());
        }
      });
      return;
    case "heading1":
    case "heading2":
    case "heading3": {
      const level = HEADING_LEVEL[command];
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return;
        }
        // Pressing the level the line already is turns it back into text, the
        // way pressing a list button inside that list does.
        const already = state.heading === level;
        $setBlocksType(selection, () =>
          already
            ? $createParagraphNode()
            : $createHeadingNode(`h${String(level)}` as HeadingTagType),
        );
      });
      // A heading is not a list item; leaving a list is part of becoming one.
      if (!(state.list === null)) {
        editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      }
      return;
    }
    case "bold":
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold");
      return;
    case "italic":
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic");
      return;
    case "strike":
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough");
      return;
    case "code":
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code");
      return;
    case "bullet":
    case "ordered":
    case "task": {
      if (state.list === LIST_FOR[command]) {
        editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
        return;
      }
      const insert = {
        bullet: INSERT_UNORDERED_LIST_COMMAND,
        ordered: INSERT_ORDERED_LIST_COMMAND,
        task: INSERT_CHECK_LIST_COMMAND,
      }[command];
      editor.dispatchCommand(insert, undefined);
      return;
    }
    case "codeblock":
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return;
        }
        // Whatever was selected becomes the block's first contents, which is
        // what wrapping a snippet in a fence used to do.
        const code = selection.getTextContent();
        const block = $createCodeNode(lang, code);
        $insertNodes([block]);
        // Somewhere to carry on typing after the block, which a decorator at the
        // end of a note would otherwise leave nowhere.
        if (block.getNextSibling() === null) {
          block.insertAfter($createParagraphNode());
        }
      });
      return;
  }
}
