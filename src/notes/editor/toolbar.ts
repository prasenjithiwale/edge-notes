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

import { $createCodeNode } from "./CodeNode";

export type FormatCommand =
  /** Back to a plain paragraph: what the slash menu calls "Text". */
  | "text"
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "bullet"
  | "ordered"
  | "task"
  | "codeblock";

/** Which of the toolbar's marks and list kinds the caret is currently inside. */
export interface ToolbarState {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  list: ListType | null;
}

const IDLE: ToolbarState = {
  bold: false,
  italic: false,
  strike: false,
  code: false,
  list: null,
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
    a.list === b.list
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
          const next: ToolbarState = {
            bold: selection.hasFormat("bold"),
            italic: selection.hasFormat("italic"),
            strike: selection.hasFormat("strikethrough"),
            code: selection.hasFormat("code"),
            list: $isListNode(list) ? list.getListType() : null,
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
    case "text":
      return state.list === null;
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
    case "text":
      // Whatever kind of list this line is in, it stops being one. A line that
      // is already a paragraph is left alone, which is what `REMOVE_LIST` does.
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      return;
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
