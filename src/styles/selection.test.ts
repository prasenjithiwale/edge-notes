import { describe, expect, it } from "vitest";

import cardStyles from "../notes/NoteCard.module.css?raw";
import codeStyles from "../notes/editor/CodeNode.module.css?raw";
import editorStyles from "../notes/editor/RichEditor.module.css?raw";
import global from "./global.css?raw";
import readerStyles from "../notes/NoteReader.module.css?raw";
import textStyles from "../notes/NoteText.module.css?raw";

/**
 * These six sheets are let through Vitest's CSS pipeline in `vite.config.ts`;
 * everything else is blanked for speed, and a blanked sheet reads as an empty
 * string, which would make every assertion here vacuously true.
 */
const SHEETS: [string, string][] = [
  ["global.css", global],
  ["NoteCard.module.css", cardStyles],
  ["NoteReader.module.css", readerStyles],
  ["NoteText.module.css", textStyles],
  ["RichEditor.module.css", editorStyles],
  ["CodeNode.module.css", codeStyles],
];

/** Declarations of a property, ignoring the ones inside comments. */
function declarations(css: string, property: string): string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...withoutComments.matchAll(new RegExp(`${property}:\\s*([a-z]+)`, "g"))].map(
    (match) => match[1] ?? "",
  );
}

/**
 * The chrome is not selectable (brief 7.5) and the places that hold text are.
 * `user-select` and `-webkit-user-select` are *separate properties*, and WebKit
 * — which is every engine this app ships on except Windows — honours the
 * prefixed one. So a rule that turns selection back on with only the unprefixed
 * spelling does not override the `none` inherited from `body`: WebKit refuses to
 * put a caret in the text, a click selects the whole block instead, and the
 * editor looks broken while every test still passes. That shipped in 0.3.0.
 */
describe("selectable text", () => {
  for (const [name, css] of SHEETS) {
    it(`${name} spells user-select both ways, everywhere it uses it`, () => {
      const plain = declarations(css, "(?<!-webkit-)user-select").sort();
      const prefixed = declarations(css, "-webkit-user-select").sort();
      expect(plain, `${name} has unmatched user-select declarations`).toEqual(prefixed);
    });
  }

  it("still turns selection off for the chrome as a whole", () => {
    const [, css = ""] = SHEETS[0] ?? [];
    expect(declarations(css, "(?<!-webkit-)user-select")).toContain("none");
    expect(declarations(css, "-webkit-user-select")).toContain("none");
  });

  it("turns it back on for the editor, the reader and a locked card", () => {
    for (const [name, css] of SHEETS.slice(1)) {
      expect(declarations(css, "-webkit-user-select"), name).toContain("text");
    }
  });
});
