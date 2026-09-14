/**
 * Lightweight formatting (brief 14.3): Markdown-style markers kept in plain text.
 * The note is stored exactly as typed, so export stays clean Markdown and a
 * future sync engine never sees markup. The editor shows the markers; cards
 * render them.
 *
 * Pure: parsing for the cards, and the edit transforms the editor applies.
 * Deliberately a small subset, not CommonMark — bold, italic, strikethrough,
 * bare links, and one level of bulleted, numbered and task lists.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold" | "italic" | "strike"; children: Inline[] }
  | { kind: "link"; url: string };

export type LineKind = "paragraph" | "bullet" | "ordered" | "task";

export interface Line {
  kind: LineKind;
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

export type ListKind = Exclude<LineKind, "paragraph">;
export type InlineMarker = "**" | "_" | "~~";

/** A selection in a text field. */
export interface TextState {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * One replacement of `[start, end)` by `text`, then a selection. Expressed as a
 * replacement rather than a new value so the editor can apply it as a native
 * text insertion, which keeps the platform's undo stack intact.
 */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

const LIST_ITEM =
  /^([ \t]*)(?:([-*+])[ \t]+\[([ xX])\](?:[ \t]+|$)|([-*+])[ \t]+|(\d{1,9})([.)])[ \t]+)/;

export function parseLine(line: string): Line {
  const match = LIST_ITEM.exec(line);
  if (!match) {
    return {
      kind: "paragraph",
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
  const base = { indent, prefix, text: line.slice(prefix.length) };

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
export function parseInline(text: string): Inline[] {
  return parseRange(text, 0, text.length, 0);
}

/** The text a reader sees, markers removed: for labels and accessible names. */
export function plainText(nodes: Inline[]): string {
  return nodes
    .map((node) =>
      node.kind === "text"
        ? node.text
        : node.kind === "link"
          ? node.url
          : plainText(node.children),
    )
    .join("");
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
  content.split("\n").forEach((raw, index) => {
    const line = parseLine(raw);
    const text = line.text.trim();
    if (text !== "") {
      lines.push({ ...line, text, index });
    }
  });

  const [title = null, ...rest] = lines;

  if (rest.every((line) => line.kind === "paragraph")) {
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

// ---------------------------------------------------------------------------
// Editor transforms
// ---------------------------------------------------------------------------

function lineStartOf(value: string, index: number): number {
  return index === 0 ? 0 : value.lastIndexOf("\n", index - 1) + 1;
}

function lineEndOf(value: string, index: number): number {
  const end = value.indexOf("\n", index);
  return end === -1 ? value.length : end;
}

function leadingSpace(text: string): string {
  return /^\s*/.exec(text)?.[0] ?? "";
}

function trailingSpace(text: string): string {
  return /\s*$/.exec(text)?.[0] ?? "";
}

/**
 * Bold, italic or strikethrough on the selection: wrap it, or unwrap it when it
 * is already wrapped. Markers must hug the text, so surrounding whitespace is
 * left outside them; across several lines each line is wrapped on its own, after
 * its list prefix, because a marker never spans lines. With nothing selected an
 * empty pair goes in with the caret inside, and pressing again takes it out.
 */
export function toggleInline(state: TextState, marker: InlineMarker): TextEdit | null {
  const { value } = state;
  const len = marker.length;
  let start = state.selectionStart;
  let end = state.selectionEnd;

  if (start === end) {
    if (
      value.slice(start - len, start) === marker &&
      value.slice(start, start + len) === marker
    ) {
      return {
        start: start - len,
        end: start + len,
        text: "",
        selectionStart: start - len,
        selectionEnd: start - len,
      };
    }
    return {
      start,
      end,
      text: marker + marker,
      selectionStart: start + len,
      selectionEnd: start + len,
    };
  }

  while (start < end && /\s/.test(value[start] ?? "")) {
    start++;
  }
  while (end > start && /\s/.test(value[end - 1] ?? "")) {
    end--;
  }
  if (start === end) {
    return null;
  }

  const selected = value.slice(start, end);
  const singleLine = !selected.includes("\n");

  // The selection is the inside of a pair: the usual state after wrapping.
  if (
    singleLine &&
    value.slice(start - len, start) === marker &&
    value.slice(end, end + len) === marker
  ) {
    return {
      start: start - len,
      end: end + len,
      text: selected,
      selectionStart: start - len,
      selectionEnd: end - len,
    };
  }

  const segments = selected.split("\n");
  const firstAtLineStart = value.slice(lineStartOf(value, start), start).trim() === "";

  // Split each segment into what stays outside the markers and what goes inside.
  const parts = segments.map((segment, index) => {
    const lead = leadingSpace(segment);
    let head = lead;
    let core = segment.slice(lead.length);
    if (index > 0 || firstAtLineStart) {
      const line = parseLine(core);
      if (line.kind !== "paragraph") {
        head += line.prefix;
        core = line.text;
      }
    }
    const trail = trailingSpace(core);
    return { head, core: core.slice(0, core.length - trail.length), trail };
  });

  const filled = parts.filter((part) => part.core !== "");
  if (filled.length === 0) {
    return null;
  }
  const unwrap = filled.every(
    (part) =>
      part.core.length >= 2 * len &&
      part.core.startsWith(marker) &&
      part.core.endsWith(marker),
  );

  const text = parts
    .map(({ head, core, trail }) => {
      if (core === "") {
        return head + trail;
      }
      const inner = unwrap ? core.slice(len, core.length - len) : marker + core + marker;
      return head + inner + trail;
    })
    .join("\n");

  if (singleLine && !unwrap && parts[0]?.head === "") {
    return {
      start,
      end,
      text,
      selectionStart: start + len,
      selectionEnd: end + len,
    };
  }
  return { start, end, text, selectionStart: start, selectionEnd: start + text.length };
}

function listPrefix(kind: ListKind, number: number): string {
  switch (kind) {
    case "bullet":
      return "- ";
    case "ordered":
      return `${String(number)}. `;
    case "task":
      return "- [ ] ";
  }
}

/**
 * Turn every line the selection touches into a list item of `kind`, or back into
 * plain lines when they all already are one. A line that is another kind of list
 * item is converted; a task keeps its tick. Numbering continues from an ordered
 * item directly above.
 */
export function toggleList(state: TextState, kind: ListKind): TextEdit {
  const { value, selectionStart, selectionEnd } = state;
  // A selection ending at the very start of a line does not include that line.
  const lastIndex =
    selectionEnd > selectionStart && value[selectionEnd - 1] === "\n"
      ? selectionEnd - 1
      : selectionEnd;
  const start = lineStartOf(value, selectionStart);
  const end = lineEndOf(value, lastIndex);
  const lines = value.slice(start, end).split("\n");
  const parsed = lines.map(parseLine);

  const counts = (index: number) => lines.length === 1 || (lines[index] ?? "").trim() !== "";
  const removing = parsed.every((line, index) => !counts(index) || line.kind === kind);

  const above = start > 0 ? parseLine(value.slice(lineStartOf(value, start - 1), start - 1)) : null;
  let number = above?.kind === "ordered" ? above.number : 0;

  const prefixLengths: { before: number; after: number }[] = [];
  const out = lines.map((line, index) => {
    const item = parsed[index] ?? parseLine(line);
    const indent = item.kind === "paragraph" ? leadingSpace(line) : item.indent;
    const before = item.kind === "paragraph" ? indent.length : item.prefix.length;
    const body = line.slice(before);

    let next: string;
    if (!counts(index)) {
      next = line;
    } else if (removing) {
      next = indent + body;
    } else if (item.kind === kind && kind !== "ordered") {
      next = line;
    } else {
      number += 1;
      next = indent + listPrefix(kind, number) + body;
    }
    prefixLengths.push({ before, after: before + next.length - line.length });
    return next;
  });

  const text = out.join("\n");

  if (selectionStart === selectionEnd && lines.length === 1) {
    const { before, after } = prefixLengths[0] ?? { before: 0, after: 0 };
    const offset = selectionStart - start;
    const caret = start + Math.max(after, offset - before + after);
    return { start, end, text, selectionStart: caret, selectionEnd: caret };
  }
  return { start, end, text, selectionStart: start, selectionEnd: start + text.length };
}

/**
 * Enter inside a list item starts the next item: the same bullet, the next
 * number, an unticked box. Enter on an item with no text ends the list instead.
 * Null when Enter should just insert a newline.
 */
export function continueList(state: TextState): TextEdit | null {
  const { value, selectionStart, selectionEnd } = state;
  if (selectionStart !== selectionEnd) {
    return null;
  }
  const start = lineStartOf(value, selectionStart);
  const end = lineEndOf(value, selectionStart);
  const item = parseLine(value.slice(start, end));

  if (item.kind === "paragraph" || selectionStart - start < item.prefix.length) {
    return null;
  }

  if (item.text.trim() === "") {
    return { start, end, text: "", selectionStart: start, selectionEnd: start };
  }

  const marker =
    item.kind === "ordered"
      ? `${String(item.number + 1)}${item.marker} `
      : item.kind === "task"
        ? `${item.marker} [ ] `
        : `${item.marker} `;
  const text = `\n${item.indent}${marker}`;
  const caret = selectionStart + text.length;
  return {
    start: selectionStart,
    end: selectionStart,
    text,
    selectionStart: caret,
    selectionEnd: caret,
  };
}
