/**
 * Pipe tables, this dialect's last multi-line block (after the code fence).
 *
 * The syntax is GFM's, and deliberately so: it is what every other Markdown app
 * reads, so a note with a table in it is still worth exporting, still worth
 * pasting somewhere else, and still plain text in the database.
 *
 *     | Day | Cost |
 *     | --- | ---: |
 *     | Mon | 12   |
 *
 * Alignment is parsed and written back even though nothing in the app sets it.
 * A table pasted in from somewhere else has alignment in it, and a dialect that
 * reads something it cannot write is a dialect that loses it on the next save.
 */

export type Align = "left" | "center" | "right" | null;

export interface Table {
  /** The first row, which is drawn as the heading. */
  header: string[];
  rows: string[][];
  /** One entry per column, from the separator row. */
  align: Align[];
}

/** A line that could be part of a table: it has at least one pipe. */
const ROW = /\|/;
/** `---`, `:--`, `--:` or `:-:`, with at least one dash. */
const DIVIDER = /^:?-{1,}:?$/;

/**
 * The cells of one `| a | b |` line.
 *
 * The outer pipes are optional in GFM and both spellings are common, so a
 * leading or trailing empty cell created by them is dropped — but only one, or
 * a table with a deliberately empty first column would lose it.
 */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const character of line.trim()) {
    if (escaped) {
      // A `\|` is a pipe in the text, not a cell boundary.
      cell += character === "|" ? "|" : `\\${character}`;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += character;
  }
  if (escaped) {
    cell += "\\";
  }
  cells.push(cell.trim());

  if (cells.length > 1 && cells[0] === "") {
    cells.shift();
  }
  if (cells.length > 1 && cells[cells.length - 1] === "") {
    cells.pop();
  }
  return cells;
}

function alignOf(cell: string): Align {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) {
    return "center";
  }
  if (right) {
    return "right";
  }
  return left ? "left" : null;
}

/**
 * A table starting at `lines[at]`, or null.
 *
 * It takes a header, a divider row and any number of body rows, which is the
 * shape every Markdown app agrees on. A row with a different number of cells is
 * still taken — padded or trimmed to the header's width — because a table you
 * are still typing has ragged rows, and refusing to see it would make it
 * disappear as you worked on it.
 */
export function parseTable(
  lines: string[],
  at: number,
): { table: Table; to: number } | null {
  const head = lines[at];
  const divider = lines[at + 1];
  if (head === undefined || divider === undefined) {
    return null;
  }
  if (!ROW.test(head) || !ROW.test(divider)) {
    return null;
  }
  const header = splitRow(head);
  const marks = splitRow(divider);
  if (header.length === 0 || marks.length !== header.length) {
    return null;
  }
  if (!marks.every((cell) => DIVIDER.test(cell))) {
    return null;
  }

  const align = marks.map(alignOf);
  const rows: string[][] = [];
  let end = at + 2;
  while (end < lines.length && ROW.test(lines[end] ?? "")) {
    rows.push(fit(splitRow(lines[end] ?? ""), header.length));
    end += 1;
  }
  return { table: { header, rows, align }, to: end };
}

/** A row at the table's width: short rows are padded, long ones are cut. */
function fit(cells: string[], width: number): string[] {
  const row = cells.slice(0, width);
  while (row.length < width) {
    row.push("");
  }
  return row;
}

function dividerCell(align: Align): string {
  switch (align) {
    case "left":
      return ":---";
    case "center":
      return ":---:";
    case "right":
      return "---:";
    default:
      return "---";
  }
}

/** A cell as it is written: a pipe inside one has to be escaped. */
function cellText(cell: string): string {
  return cell.replace(/\|/g, "\\|");
}

/**
 * The table as text. One canonical spelling — outer pipes, single spaces — so
 * that what the editor writes is stable: a table that came out differently
 * every time it was saved would show as an edit nobody made.
 */
export function formatTable(table: Table): string {
  const width = table.header.length;
  const line = (cells: string[]) =>
    `| ${fit(cells, width).map(cellText).join(" | ")} |`;

  return [
    line(table.header),
    `| ${table.align.slice(0, width).map(dividerCell).join(" | ")} |`,
    ...table.rows.map(line),
  ].join("\n");
}

/** An empty table of the given shape, for the slash menu to insert. */
export function emptyTable(columns = 2, rows = 2): Table {
  return {
    header: Array.from({ length: columns }, () => ""),
    rows: Array.from({ length: rows }, () => Array.from({ length: columns }, () => "")),
    align: Array.from({ length: columns }, () => null),
  };
}
