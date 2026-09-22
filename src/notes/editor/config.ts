/**
 * What the note editor is made of: which node types exist, and the class names
 * the editor puts on them.
 *
 * The node list is deliberately short. A note has paragraphs, headings of three
 * levels, three kinds of list, bare links and code blocks — no quotes — because that is the whole of the Markdown dialect a note is stored
 * in, and a node the dialect cannot write is a node that would be lost on the
 * next save. Headings joined the dialect in 0.5.0; `####` still cannot be
 * written, so there is no h4.
 */
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode } from "@lexical/rich-text";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import type { EditorThemeClasses, Klass, LexicalNode } from "lexical";

import { CodeNode } from "./CodeNode";
import { ImageNode } from "./ImageNode";
import { TableNode } from "./TableNode";
import styles from "./RichEditor.module.css";

/**
 * CSS modules are typed as possibly-missing, and Lexical's theme is not. A class
 * that is not in the stylesheet is a build mistake, not a runtime case.
 */
function cls(name: string | undefined): string {
  return name ?? "";
}

export const EDITOR_NODES: Klass<LexicalNode>[] = [
  HeadingNode,
  ListNode,
  ListItemNode,
  LinkNode,
  AutoLinkNode,
  CodeNode,
  ImageNode,
  TableNode,
];

export const EDITOR_THEME: EditorThemeClasses = {
  paragraph: cls(styles.paragraph),
  heading: {
    h1: cls(styles.h1),
    h2: cls(styles.h2),
    h3: cls(styles.h3),
  },
  link: cls(styles.link),
  text: {
    bold: cls(styles.bold),
    italic: cls(styles.italic),
    strikethrough: cls(styles.strike),
    code: cls(styles.inlineCode),
  },
  list: {
    ul: cls(styles.bulletList),
    ol: cls(styles.orderedList),
    listitem: cls(styles.listItem),
    listitemChecked: cls(styles.checked),
    listitemUnchecked: cls(styles.unchecked),
    nested: { listitem: cls(styles.nestedItem) },
  },
};
