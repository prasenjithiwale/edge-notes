/**
 * Typing Markdown still works — that is what "optional" means here.
 *
 * Nobody has to know the syntax any more: the toolbar and the shortcuts do
 * everything. But someone who already types `- ` at the start of a line, or
 * wraps a word in `**`, should get what they asked for rather than a literal
 * pair of asterisks. These are the shortcuts that fire while typing; the storage
 * format is written by `editor/markdown.ts` and is always ours.
 *
 * The list is built from the library's pieces rather than taken whole: its
 * `TRANSFORMERS` includes headings, quotes and its own code block, none of which
 * this dialect can store, and a node that cannot be written back is a node that
 * would be lost on the next save.
 */
import {
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  CHECK_LIST,
  INLINE_CODE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  ORDERED_LIST,
  STRIKETHROUGH,
  UNORDERED_LIST,
  type ElementTransformer,
  type Transformer,
} from "@lexical/markdown";
import type { LinkMatcher } from "@lexical/react/LexicalAutoLinkPlugin";

import { $createCodeNode, CodeNode } from "./CodeNode";

/**
 * ```` ```python ```` at the start of a line opens a code block in that
 * language. Only the opening fence: the closing one is the block's edge, and
 * there is nothing to type it into.
 */
const CODE_FENCE: ElementTransformer = {
  dependencies: [CodeNode],
  // Writing is `editor/markdown.ts`'s job, and it walks the whole note rather
  // than one node at a time.
  export: () => null,
  regExp: /^```([A-Za-z0-9+#-]*)[ \t]$/,
  replace: (parentNode, _children, match) => {
    const block = $createCodeNode(match[1] ?? "", "");
    parentNode.replace(block);
  },
  type: "element",
};

export const NOTE_TRANSFORMERS: Transformer[] = [
  CODE_FENCE,
  UNORDERED_LIST,
  ORDERED_LIST,
  CHECK_LIST,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
  INLINE_CODE,
];

/**
 * A bare web address, which is the only kind of link the dialect has.
 *
 * Mutable arrays, not `readonly` ones, for a reason that is not about types:
 * both of these are handed straight to a Lexical plugin, and both plugins list
 * the prop in their effect's dependencies. A `readonly` array would have to be
 * copied at the call site to satisfy the prop, and a fresh copy every render
 * tears the plugin down and registers it again — which schedules a transform
 * pass, which is an update, which re-renders, which copies again. See
 * `NoteEditor`.
 */
export const LINK_MATCHERS: LinkMatcher[] = [
  (text: string) => {
    const match = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?'"*_~)]/.exec(text);
    if (match === null) {
      return null;
    }
    return {
      index: match.index,
      length: match[0].length,
      text: match[0],
      url: match[0],
    };
  },
];
