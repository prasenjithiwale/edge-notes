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

export function useToolbarState(editor: LexicalEditor): ToolbarState {
  const [state, setState] = useState<ToolbarState>(IDLE);

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) {
            setState(IDLE);
            return;
          }
          const node = selection.anchor.getNode();
          const item = $isListItemNode(node) ? node : node.getParent();
          const list = $isListItemNode(item) ? item.getParent() : null;
          setState({
            bold: selection.hasFormat("bold"),
            italic: selection.hasFormat("italic"),
            strike: selection.hasFormat("strikethrough"),
            code: selection.hasFormat("code"),
            list: $isListNode(list) ? list.getListType() : null,
          });
        });
      }),
    [editor],
  );

  return state;
}

/** Whether the caret is already inside what this button applies. */
export function isActive(command: FormatCommand, state: ToolbarState): boolean {
  switch (command) {
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
