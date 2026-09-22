import { describe, expect, it } from "vitest";

import { emptyTable, formatTable, parseTable, splitRow } from "./table";

const lines = (text: string) => text.split("\n");

/**
 * The dialect's last multi-line block. Two things decide the shape of this:
 * what every other Markdown app reads, so a note with a table is still worth
 * pasting elsewhere, and what can be written back byte for byte, because a
 * table that came out differently each time would show as an edit nobody made.
 */
describe("a pipe table", () => {
  it("reads a header, a divider and the rows under it", () => {
    const found = parseTable(lines("| Day | Cost |\n| --- | --- |\n| Mon | 12 |"), 0);
    expect(found?.table).toEqual({
      header: ["Day", "Cost"],
      rows: [["Mon", "12"]],
      align: [null, null],
    });
    expect(found?.to).toBe(3);
  });

  it("keeps alignment, which nothing in the app sets but other apps write", () => {
    const found = parseTable(lines("| a | b | c |\n| :-- | :-: | --: |"), 0);
    expect(found?.table.align).toEqual(["left", "center", "right"]);
    expect(formatTable(found?.table ?? emptyTable())).toBe("| a | b | c |\n| :--- | :---: | ---: |");
  });

  it("is not fooled by lines that only have pipes in them", () => {
    // No divider under the header.
    expect(parseTable(lines("| a | b |\n| 1 | 2 |"), 0)).toBeNull();
    // A divider of a different width is not this table's divider.
    expect(parseTable(lines("| a | b |\n| --- |"), 0)).toBeNull();
    // Prose with a pipe in it.
    expect(parseTable(lines("a | b"), 0)).toBeNull();
  });

  it("takes a ragged row rather than losing the table while it is typed", () => {
    const found = parseTable(lines("| a | b |\n| --- | --- |\n| 1 |\n| 1 | 2 | 3 |"), 0);
    expect(found?.table.rows).toEqual([
      ["1", ""],
      ["1", "2"],
    ]);
  });

  it("round-trips a cell with a pipe in it", () => {
    const text = "| a | b |\n| --- | --- |\n| x \\| y | 2 |";
    const found = parseTable(lines(text), 0);
    expect(found?.table.rows[0]).toEqual(["x | y", "2"]);
    expect(formatTable(found?.table ?? emptyTable())).toBe(text);
  });

  it("writes one canonical spelling, whatever it was given", () => {
    const found = parseTable(lines("a|b\n-|-\n1|2"), 0);
    expect(formatTable(found?.table ?? emptyTable())).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |");
  });

  it("drops only the cells the outer pipes create", () => {
    expect(splitRow("| a | b |")).toEqual(["a", "b"]);
    expect(splitRow("a | b")).toEqual(["a", "b"]);
    // A genuinely empty first column survives, because only one empty cell at
    // each end is taken as punctuation.
    expect(splitRow("|  | b |")).toEqual(["", "b"]);
  });
});
