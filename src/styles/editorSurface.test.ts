import { describe, expect, it } from "vitest";

import editorStyles from "../notes/editor/RichEditor.module.css?raw";
import noteEditorStyles from "../notes/NoteEditor.module.css?raw";

/** One rule's body, comments stripped. The selectors here are unique. */
function body(css: string, selector: string): string {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found = [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(
    (match) => (match[1] ?? "").trim().replace(/\s+/g, " ") === selector,
  );
  return found?.[2] ?? "";
}

/**
 * Where a press lands in the expanded editor.
 *
 * The large panel is both taller and wider than a note's text, and the editable
 * is only as big as what is written in it. Everything else in that panel is
 * surface with no caret behind it: pressing there puts the caret nowhere, which
 * leaves the arrow keys as the only way to reach a line and makes a note that is
 * open for writing look like it cannot be written in.
 *
 * So the column is the editable's own padding rather than a width on its parent,
 * and the editable fills the height rather than stopping at the last line. Both
 * are custom properties the large panel sets and the editable reads, and jsdom
 * has no layout to check them by — this reads the sheets instead, as the
 * `user-select` pairs are read.
 */
describe("the editor's click target", () => {
  const editable = body(editorStyles, ".editable");
  const large = body(noteEditorStyles, ".large .body");

  it("lets the editable fill the large panel's height", () => {
    expect(editable).toMatch(/min-height:\s*var\(--editable-fill,/);
    expect(large).toMatch(/--editable-fill:\s*100%/);
  });

  it("carries the reading measure as the editable's own gutter", () => {
    expect(editable).toMatch(/padding-inline:\s*var\(--editable-gutter,/);
    expect(large).toMatch(/--editable-gutter:.*--reading-measure/);
  });

  it("does not put the measure back on the body, where a press is dead", () => {
    expect(large).not.toMatch(/max-width/);
  });
});
