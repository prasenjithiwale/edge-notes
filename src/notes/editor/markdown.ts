/**
 * Our Markdown dialect, in and out of the editor's node tree.
 *
 * Why this is written here rather than taken from `@lexical/markdown`: a note is
 * stored exactly as it is written, and the library's dialect is not ours. It
 * writes `*italic*` where we write `_italic_`, `*` bullets where we write `-`,
 * and it has no opinion about a bare URL. Round-tripping through it would
 * silently rewrite every note the first time it was opened. Reading uses the
 * parser the cards already use (`lib/markdown.ts`), so the editor and the card
 * can never disagree about what a note says.
 *
 * The rule both directions keep: `toMarkdown(fromMarkdown(x))` is `x` for
 * anything the app itself writes, and parses the same for anything else.
 */
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isLineBreakNode,
  $isParagraphNode,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
  type TextFormatType,
} from "lexical";
import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  type ListNode,
  type ListType,
} from "@lexical/list";
import { $createLinkNode, $isLinkNode } from "@lexical/link";
import { $createHeadingNode, $isHeadingNode, type HeadingTagType } from "@lexical/rich-text";

import { parseBlocks, parseInline, type Inline, type ListKind } from "../../lib/markdown";
import { $createCodeNode, $isCodeNode } from "./CodeNode";
import { $createImageNode } from "./ImageNode";

/** Our list kinds and Lexical's names for the same three things. */
const LIST_TYPE: Record<ListKind, ListType> = {
  bullet: "bullet",
  ordered: "number",
  task: "check",
};

/** Two spaces to a level, which is what the serialiser writes back out. */
const INDENT = "  ";

// ---------------------------------------------------------------------------
// Markdown to nodes
// ---------------------------------------------------------------------------

/** The marks on one run of text, as Lexical's format flags. */
interface Marks {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
}

const NO_MARKS: Marks = { bold: false, italic: false, strike: false, code: false };

function applyMarks(node: ReturnType<typeof $createTextNode>, marks: Marks): void {
  const formats: [keyof Marks, TextFormatType][] = [
    ["bold", "bold"],
    ["italic", "italic"],
    ["strike", "strikethrough"],
    ["code", "code"],
  ];
  for (const [mark, format] of formats) {
    if (marks[mark]) {
      node.toggleFormat(format);
    }
  }
}

/** One line's inline tree, as text nodes with formats and links. */
function inlineNodes(nodes: Inline[], marks: Marks): LexicalNode[] {
  return nodes.flatMap((node): LexicalNode[] => {
    switch (node.kind) {
      case "text": {
        const text = $createTextNode(node.text);
        applyMarks(text, marks);
        return [text];
      }
      case "code": {
        const text = $createTextNode(node.text);
        applyMarks(text, { ...marks, code: true });
        return [text];
      }
      case "bold":
        return inlineNodes(node.children, { ...marks, bold: true });
      case "italic":
        return inlineNodes(node.children, { ...marks, italic: true });
      case "strike":
        return inlineNodes(node.children, { ...marks, strike: true });
      case "image": {
        // The bytes are a file; the note holds the link, and so does the node.
        return [$createImageNode(node.url, node.alt)];
      }
      case "link": {
        // A bare URL, which is the only kind of link the dialect has: the link
        // node's text is the address, so it writes back out as what was typed.
        const link = $createLinkNode(node.url);
        const text = $createTextNode(node.url);
        applyMarks(text, marks);
        link.append(text);
        return [link];
      }
    }
  });
}

function paragraphFor(text: string): ElementNode {
  const paragraph = $createParagraphNode();
  paragraph.append(...inlineNodes(parseInline(text), NO_MARKS));
  return paragraph;
}

/**
 * Replace the editor's contents with a note. Runs inside `editor.update`.
 *
 * Consecutive list lines of the same kind become one list, so ticking and
 * renumbering behave; a change of kind starts a new one, which is what the text
 * said.
 */
export function $setFromMarkdown(content: string): void {
  const root = $getRoot();
  root.clear();

  let list: ListNode | null = null;
  let listKind: ListKind | null = null;

  for (const block of parseBlocks(content)) {
    if (block.kind === "code") {
      list = null;
      listKind = null;
      root.append($createCodeNode(block.lang, block.code));
      continue;
    }

    const { line } = block;
    if (line.kind === "paragraph") {
      list = null;
      listKind = null;
      root.append(paragraphFor(line.text));
      continue;
    }

    if (line.kind === "heading") {
      list = null;
      listKind = null;
      const heading = $createHeadingNode(`h${String(line.level)}` as HeadingTagType);
      heading.append(...inlineNodes(parseInline(line.text), NO_MARKS));
      root.append(heading);
      continue;
    }

    if (list === null || listKind !== line.kind) {
      list = $createListNode(LIST_TYPE[line.kind]);
      listKind = line.kind;
      root.append(list);
    }
    const item = $createListItemNode(line.kind === "task" ? line.checked : undefined);
    item.append(...inlineNodes(parseInline(line.text), NO_MARKS));
    list.append(item);
    // After it is in the list, never before: indenting an item nests it under
    // the one above, so it needs a list and a sibling to be nested into.
    const depth = Math.floor(line.indent.replace(/\t/g, INDENT).length / INDENT.length);
    if (depth > 0) {
      item.setIndent(depth);
    }
  }

  if (root.getChildrenSize() === 0) {
    root.append($createParagraphNode());
  }
}

// ---------------------------------------------------------------------------
// Nodes to Markdown
// ---------------------------------------------------------------------------

/**
 * One stretch of text with the same marks on it. A link is one of these too,
 * and an unsplittable one: its text is its address.
 */
interface Run {
  text: string;
  marks: Marks;
}

/**
 * Outermost first. The order is the one `parseInline` reads back, and the one
 * `wrap` used to write: bold outside strikethrough outside italic, and code
 * innermost because its contents are literal.
 */
const MARK_ORDER: (keyof Marks)[] = ["bold", "strike", "italic", "code"];

const MARKER: Record<keyof Marks, string> = {
  bold: "**",
  strike: "~~",
  italic: "_",
  code: "`",
};

function marksOf(node: LexicalNode): Marks {
  if (!$isTextNode(node)) {
    return NO_MARKS;
  }
  return {
    bold: node.hasFormat("bold"),
    italic: node.hasFormat("italic"),
    strike: node.hasFormat("strikethrough"),
    code: node.hasFormat("code"),
  };
}

function marked(marks: Marks): boolean {
  return MARK_ORDER.some((mark) => marks[mark]);
}

/**
 * Runs back into markers.
 *
 * The editor holds formatting flat — three neighbouring runs each carrying
 * `bold`, one of which also carries `italic` — and Markdown is nested. Writing
 * each run on its own would close and reopen the bold around the italic and
 * produce `**a ****_b_**** c**`, which is not what was read in and does not parse
 * back to the same thing. So: take the first run's outermost mark, find how many
 * runs after it share that mark, and wrap that whole stretch once, recursing
 * inside it with the mark taken off.
 */
function emitRuns(runs: Run[]): string {
  const rest = runs.filter((run) => run.text !== "");
  if (rest.length === 0) {
    return "";
  }
  const [first] = rest;
  if (first === undefined) {
    return "";
  }

  for (const mark of MARK_ORDER) {
    if (!first.marks[mark]) {
      continue;
    }
    let end = 1;
    while (end < rest.length && rest[end]?.marks[mark] === true) {
      end += 1;
    }
    const inner = rest
      .slice(0, end)
      .map((run) => ({ ...run, marks: { ...run.marks, [mark]: false } }));
    return `${MARKER[mark]}${emitRuns(inner)}${MARKER[mark]}${emitRuns(rest.slice(end))}`;
  }

  let end = 1;
  while (end < rest.length && !marked(rest[end]?.marks ?? NO_MARKS)) {
    end += 1;
  }
  return (
    rest
      .slice(0, end)
      .map((run) => run.text)
      .join("") + emitRuns(rest.slice(end))
  );
}

/**
 * An element's children as runs, split at hard line breaks: a marker never spans
 * a line, so neither may a stretch of runs sharing one.
 */
function runLines(element: ElementNode): Run[][] {
  const lines: Run[][] = [[]];
  const push = (run: Run) => {
    lines[lines.length - 1]?.push(run);
  };

  for (const child of element.getChildren()) {
    if ($isLineBreakNode(child)) {
      lines.push([]);
      continue;
    }
    if ($isLinkNode(child)) {
      // Only bare links exist in the dialect, so the address is the text, and it
      // cannot be split by a marker starting inside it.
      const [inner] = child.getChildren();
      push({ text: child.getURL(), marks: inner === undefined ? NO_MARKS : marksOf(inner) });
      continue;
    }
    if ($isTextNode(child)) {
      push({ text: child.getTextContent(), marks: marksOf(child) });
      continue;
    }
    push({ text: child.getTextContent(), marks: NO_MARKS });
  }
  return lines;
}

/** One element's children as one or more lines of Markdown. */
function inlineMarkdown(element: ElementNode): string[] {
  return runLines(element).map(emitRuns);
}

function listMarker(
  type: ListType,
  item: ReturnType<typeof $createListItemNode>,
  n: number,
): string {
  if (type === "number") {
    return `${String(n)}. `;
  }
  if (type === "check") {
    return item.getChecked() === true ? "- [x] " : "- [ ] ";
  }
  return "- ";
}

/**
 * A list as lines. Lexical holds an indented item as a list nested inside an
 * otherwise empty item, so the depth comes from the recursion rather than from
 * the item, and is written back as two spaces a level.
 */
function listMarkdown(list: ListNode, depth: number): string[] {
  const type = list.getListType();
  const lines: string[] = [];
  let n = list.getStart();
  for (const child of list.getChildren()) {
    if (!$isListItemNode(child)) {
      continue;
    }
    const nested = child.getChildren().filter($isListNode);
    if (nested.length > 0) {
      for (const inner of nested) {
        lines.push(...listMarkdown(inner, depth + 1));
      }
      continue;
    }
    lines.push(
      INDENT.repeat(depth) + listMarker(type, child, n) + inlineMarkdown(child).join(" "),
    );
    n += 1;
  }
  return lines;
}

/** The note as it is stored. Runs inside `editorState.read`. */
export function $toMarkdown(): string {
  const lines: string[] = [];
  for (const child of $getRoot().getChildren()) {
    if ($isCodeNode(child)) {
      lines.push(`\`\`\`${child.getLang()}`, ...child.getCode().split("\n"), "```");
      continue;
    }
    if ($isListNode(child)) {
      lines.push(...listMarkdown(child, 0));
      continue;
    }
    if ($isHeadingNode(child)) {
      // The tag is `h1`..`h3` by construction — the editor is given no other
      // heading nodes — and its number is the number of hashes.
      const hashes = "#".repeat(Number(child.getTag().slice(1)));
      lines.push(...inlineMarkdown(child).map((line) => `${hashes} ${line}`));
      continue;
    }
    if ($isParagraphNode(child)) {
      lines.push(...inlineMarkdown(child));
      continue;
    }
    lines.push(...child.getTextContent().split("\n"));
  }
  return lines.join("\n");
}
