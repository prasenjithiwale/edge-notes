/**
 * Lightweight formatting (brief 14.3): Markdown-style markers kept in plain text.
 * The note is stored exactly as typed, so export stays clean Markdown and a
 * future sync engine never sees markup. The editor shows the markers; cards
 * render them.
 *
 * Pure parsing, and only parsing: the cards, the reader and the editor all read
 * a note through here, so they can never disagree about what it says. Writing it
 * back out is `notes/editor/markdown.ts`, which is the only thing that needs to
 * know how to compose the markers rather than read them.
 *
 * Deliberately a small subset, not CommonMark — bold, italic, strikethrough,
 * inline code, bare links, one level of bulleted, numbered and task lists, and
 * fenced code blocks.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold" | "italic" | "strike"; children: Inline[] }
  /** Between single backticks. Its contents are never parsed further. */
  | { kind: "code"; text: string }
  | { kind: "link"; url: string }
  /**
   * `![alt](url)`: a picture pasted or dropped into the note (idea 17). The
   * bytes are a file in the app data folder and the note holds only this link,
   * so a note is still plain text and still the thing that gets exported.
   */
  | { kind: "image"; url: string; alt: string };

export type LineKind = "paragraph" | "heading" | "bullet" | "ordered" | "task";

export interface Line {
  kind: LineKind;
  /**
   * 1, 2 or 3 for a heading; 0 for everything else.
   *
   * Three levels and no more, because a note in a 320 px panel that needs a
   * fourth is a note that wants to be two notes — and because the dialect can
   * only offer what it can write back: `####` stays literal text, exactly as it
   * would have before headings existed.
   */
  level: number;
  /** Leading whitespace of a list item; empty for a paragraph. */
  indent: string;
  /** Everything before the text: indent plus marker, e.g. `"  - [ ] "`. */
  prefix: string;
  /** The line after its prefix. A paragraph's text is the whole line. */
  text: string;
  /** Tasks only. */
  checked: boolean;
  /** Ordered items only: the number as written. */
  number: number;
  /** `-`, `*` or `+` for bullets and tasks; `.` or `)` for ordered items. */
  marker: string;
}

export type ListKind = Exclude<LineKind, "paragraph" | "heading">;

const LIST_ITEM =
  /^([ \t]*)(?:([-*+])[ \t]+\[([ xX])\](?:[ \t]+|$)|([-*+])[ \t]+|(\d{1,9})([.)])[ \t]+)/;

/**
 * `# `, `## ` or `### ` at the very start of a line. Not indented: an indented
 * hash is a line of text that begins with a hash, and a heading inside a list is
 * not something this dialect can write back.
 */
const HEADING = /^(#{1,3})[ \t]+(.*)$/;

export function parseLine(line: string): Line {
  const heading = HEADING.exec(line);
  if (heading) {
    const hashes = heading[1] ?? "#";
    return {
      kind: "heading",
      level: hashes.length,
      indent: "",
      prefix: `${hashes} `,
      text: heading[2] ?? "",
      checked: false,
      number: 0,
      marker: hashes,
    };
  }

  const match = LIST_ITEM.exec(line);
  if (!match) {
    return {
      kind: "paragraph",
      level: 0,
      indent: "",
      prefix: "",
      text: line,
      checked: false,
      number: 0,
      marker: "",
    };
  }

  const [prefix, indent = "", taskMarker, check, bulletMarker, digits, delimiter] =
    match;
  const base = { indent, prefix, text: line.slice(prefix.length), level: 0 };

  if (taskMarker !== undefined) {
    return {
      ...base,
      kind: "task",
      checked: check !== " ",
      number: 0,
      marker: taskMarker,
    };
  }
  if (bulletMarker !== undefined) {
    return { ...base, kind: "bullet", checked: false, number: 0, marker: bulletMarker };
  }
  return {
    ...base,
    kind: "ordered",
    checked: false,
    number: Number(digits),
    marker: delimiter ?? ".",
  };
}

// ---------------------------------------------------------------------------
// Inline parsing
// ---------------------------------------------------------------------------

/** Nesting deeper than this is shown literally; nobody writes it on purpose. */
const MAX_DEPTH = 4;

const MARKERS = ["**", "~~", "*", "_"] as const;
type ParsedMarker = (typeof MARKERS)[number];

const MARKER_KIND: Record<ParsedMarker, "bold" | "italic" | "strike"> = {
  "**": "bold",
  "~~": "strike",
  "*": "italic",
  _: "italic",
};

const URL_AT = /https?:\/\/[^\s<>"]+/y;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch);
}

function count(text: string, ch: string): number {
  return text.split(ch).length - 1;
}

/** A bare web link starting at `i`, without the sentence punctuation after it. */
function linkAt(text: string, i: number, end: number): string | null {
  if (text[i] !== "h" || isWordChar(text[i - 1])) {
    return null;
  }
  URL_AT.lastIndex = i;
  const match = URL_AT.exec(text.slice(0, end));
  if (!match) {
    return null;
  }
  let url = match[0];
  // Trailing punctuation belongs to the sentence, and a closing parenthesis only
  // to the link if the link opened one.
  for (;;) {
    const last = url.slice(-1);
    if (/[.,;:!?'"*_~]/.test(last)) {
      url = url.slice(0, -1);
    } else if (last === ")" && count(url, ")") > count(url, "(")) {
      url = url.slice(0, -1);
    } else {
      break;
    }
  }
  return /^https?:\/\/[^/]/.test(url) ? url : null;
}

function markerAt(text: string, i: number): ParsedMarker | null {
  return MARKERS.find((marker) => text.startsWith(marker, i)) ?? null;
}

function canOpen(text: string, i: number, marker: ParsedMarker): boolean {
  if (isSpace(text[i + marker.length])) {
    return false;
  }
  // snake_case_names are not italics.
  return !(marker === "_" && isWordChar(text[i - 1]));
}

function canClose(text: string, i: number, marker: ParsedMarker): boolean {
  if (isSpace(text[i - 1])) {
    return false;
  }
  if (marker === "_" && isWordChar(text[i + marker.length])) {
    return false;
  }
  // A single `*` that is really half of `**` closes nothing.
  return !(marker === "*" && (text[i + 1] === "*" || text[i - 1] === "*"));
}

function findClose(
  text: string,
  from: number,
  end: number,
  marker: ParsedMarker,
): number {
  for (let j = from + 1; j + marker.length <= end; j++) {
    if (text.startsWith(marker, j) && canClose(text, j, marker)) {
      return j;
    }
  }
  return -1;
}

function parseRange(text: string, start: number, end: number, depth: number): Inline[] {
  const nodes: Inline[] = [];
  let plain = "";
  const flushPlain = () => {
    if (plain !== "") {
      nodes.push({ kind: "text", text: plain });
      plain = "";
    }
  };
  // Once a marker has found no closer from some position, it finds none from any
  // later one either, so the search is not repeated. Keeps a line with many
  // unmatched markers linear rather than quadratic.
  const unclosedFrom = new Map<ParsedMarker, number>();

  let i = start;
  while (i < end) {
    // Code first, and its contents are taken literally: a backtick pair is the
    // one place markers are text, which is most of why anyone reaches for it.
    if (text[i] === "`") {
      const close = text.indexOf("`", i + 1);
      if (close !== -1 && close < end && close > i + 1) {
        flushPlain();
        nodes.push({ kind: "code", text: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }

    // Before the marker scan, so the `[`, `]` and `_` inside an image's own
    // syntax are never read as formatting.
    const image = imageAt(text, i, end);
    if (image !== null) {
      flushPlain();
      nodes.push({ kind: "image", url: image.url, alt: image.alt });
      i += image.length;
      continue;
    }

    const url = linkAt(text, i, end);
    if (url !== null) {
      flushPlain();
      nodes.push({ kind: "link", url });
      i += url.length;
      continue;
    }

    const marker = depth < MAX_DEPTH ? markerAt(text, i) : null;
    if (marker !== null) {
      const inner = i + marker.length;
      const failedAt = unclosedFrom.get(marker);
      if (canOpen(text, i, marker) && (failedAt === undefined || i < failedAt)) {
        const close = findClose(text, inner, end, marker);
        if (close !== -1) {
          flushPlain();
          nodes.push({
            kind: MARKER_KIND[marker],
            children: parseRange(text, inner, close, depth + 1),
          });
          i = close + marker.length;
          continue;
        }
        unclosedFrom.set(marker, i);
      }
      plain += marker;
      i = inner;
      continue;
    }

    plain += text[i] ?? "";
    i++;
  }

  flushPlain();
  return nodes;
}

/** Inline formatting within one line. Markers never span lines. */
/**
 * `![alt](url)` starting at `at`, or null.
 *
 * Written by hand rather than with a regular expression because the parser
 * scans one index at a time and a sticky regex here would be a second way of
 * saying where a node starts. Neither part may contain its own closing
 * character, and the URL may not contain a space: the alternative is a stray
 * bracket in a sentence swallowing the rest of the line.
 */
function imageAt(
  text: string,
  at: number,
  end: number,
): { url: string; alt: string; length: number } | null {
  if (text[at] !== "!" || text[at + 1] !== "[") {
    return null;
  }
  const altEnd = text.indexOf("]", at + 2);
  if (altEnd === -1 || altEnd >= end || text[altEnd + 1] !== "(") {
    return null;
  }
  const urlEnd = text.indexOf(")", altEnd + 2);
  if (urlEnd === -1 || urlEnd >= end) {
    return null;
  }
  const alt = text.slice(at + 2, altEnd);
  const url = text.slice(altEnd + 2, urlEnd);
  if (url === "" || /\s/.test(url) || alt.includes("[")) {
    return null;
  }
  return { url, alt, length: urlEnd + 1 - at };
}

export function parseInline(text: string): Inline[] {
  return parseRange(text, 0, text.length, 0);
}

/** The text a reader sees, markers removed: for labels and accessible names. */
export function plainText(nodes: Inline[]): string {
  return nodes
    .map((node) =>
      node.kind === "text" || node.kind === "code"
        ? node.text
        : node.kind === "link"
          ? node.url
          : // An image reads as whatever it was given to say, and "Image" when
            // it was given nothing: a label has to say something.
            node.kind === "image"
            ? node.alt === ""
              ? "Image"
              : node.alt
            : plainText(node.children),
    )
    .join("");
}

// ---------------------------------------------------------------------------
// Fenced code blocks
// ---------------------------------------------------------------------------

/**
 * ```` ```python ```` opens a block and ```` ``` ```` closes it, which is
 * Markdown's own fence, so a note with code in it is still a Markdown file when
 * it is exported and still plain text in the database.
 *
 * The language is whatever word follows the fence. It is kept as written rather
 * than normalised: an unknown one is still the author's word for it, and it is
 * shown as the block's label even when there is no highlighting to go with it.
 */
const FENCE_OPEN = /^[ \t]*(`{3,})[ \t]*([^`\s]*)[ \t]*$/;
const FENCE_CLOSE = /^[ \t]*`{3,}[ \t]*$/;

export interface CodeBlock {
  /** The word after the opening fence; empty for a block with no language. */
  lang: string;
  /** Everything between the fences, with no trailing newline. */
  code: string;
  /** Line index of the opening fence. */
  from: number;
  /** Line index just past the closing fence, or past the end without one. */
  to: number;
  /** False while the fence is still being typed and has no closer yet. */
  closed: boolean;
}

/**
 * A note as an ordered list of blocks: one entry per line, except that a fenced
 * run collapses into a single `code` block.
 *
 * `index` is always the line's index in the content, so ticking a checkbox still
 * finds the line it came from however many code blocks are above it.
 */
export type Block =
  | { kind: "line"; index: number; line: Line }
  | ({ kind: "code" } & CodeBlock);

export function parseBlocks(content: string): Block[] {
  const lines = content.split("\n");
  const blocks: Block[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const open = FENCE_OPEN.exec(raw);
    if (open === null) {
      blocks.push({ kind: "line", index: i, line: parseLine(raw) });
      continue;
    }

    let end = i + 1;
    while (end < lines.length && !FENCE_CLOSE.test(lines[end] ?? "")) {
      end += 1;
    }
    const closed = end < lines.length;
    blocks.push({
      kind: "code",
      lang: open[2] ?? "",
      code: lines.slice(i + 1, end).join("\n"),
      from: i,
      to: closed ? end + 1 : end,
      closed,
    });
    i = end;
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// What a card shows
// ---------------------------------------------------------------------------

/** Brief 6.8: the preview is clamped to two lines. */
export const PREVIEW_LINES = 2;

/**
 * A checklist shows more rows than a paragraph preview, because its items can be
 * ticked from the card and two would rarely be the ones that matter.
 */
export const CHECKLIST_LINES = 5;

/**
 * Enough text to fill two clamped lines several times over. Anything past it
 * could never be seen on the card, so it is not parsed either.
 */
const FLOW_CHARS = 400;

export interface CardLine extends Line {
  /** Index of this line in the note content, so a tick can find it again. */
  index: number;
  /**
   * A line from inside a fenced block. It is shown in monospace with its
   * indentation intact and is never parsed for inline markers — the point of a
   * code block is that its text is exact.
   */
  code: boolean;
}

export interface CardPreview {
  /** The first non-empty line (brief 6.8), or null for an empty note. */
  title: CardLine | null;
  /**
   * `flow` joins paragraph lines into one run of text clamped to two lines, as
   * before formatting existed. `rows` gives each line its own row, so bullets and
   * checkboxes stay aligned.
   */
  layout: "flow" | "rows";
  body: CardLine[];
  /** Non-empty lines the card has no room for; shown as "N more" on checklists. */
  hidden: number;
}

export function cardPreview(content: string): CardPreview {
  const lines: CardLine[] = [];
  const raw = content.split("\n");

  for (const block of parseBlocks(content)) {
    if (block.kind === "line") {
      const text = block.line.text.trim();
      if (text !== "") {
        lines.push({ ...block.line, text, index: block.index, code: false });
      }
      continue;
    }
    // The fences themselves are not content, so they are not previewed. What is
    // inside keeps its indentation: code that has been left-trimmed is no longer
    // the code that was written.
    for (let i = block.from + 1; i < block.to - (block.closed ? 1 : 0); i++) {
      const line = raw[i] ?? "";
      if (line.trim() !== "") {
        lines.push({ ...parseLine(""), text: line, index: i, code: true });
      }
    }
  }

  const [title = null, ...rest] = lines;

  if (rest.every((line) => line.kind === "paragraph" && !line.code)) {
    const body: CardLine[] = [];
    let chars = 0;
    for (const line of rest) {
      if (chars > FLOW_CHARS) {
        break;
      }
      body.push(line);
      chars += line.text.length + 1;
    }
    return { title, layout: "flow", body, hidden: 0 };
  }

  const limit = rest.some((line) => line.kind === "task")
    ? CHECKLIST_LINES
    : PREVIEW_LINES;
  const body = rest.slice(0, limit);
  return { title, layout: "rows", body, hidden: rest.length - body.length };
}

/** Flip the task on line `index`. Null when that line is not a task. */
export function toggleTaskLine(content: string, index: number): string | null {
  const lines = content.split("\n");
  const line = lines[index];
  if (line === undefined) {
    return null;
  }
  const parsed = parseLine(line);
  if (parsed.kind !== "task") {
    return null;
  }
  const bracket = parsed.prefix.indexOf("[");
  lines[index] =
    line.slice(0, bracket + 1) + (parsed.checked ? " " : "x") + line.slice(bracket + 2);
  return lines.join("\n");
}
