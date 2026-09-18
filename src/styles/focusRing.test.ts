import { describe, expect, it } from "vitest";

import codeStyles from "../notes/editor/CodeNode.module.css?raw";
import detailsStyles from "../notes/TaskDetails.module.css?raw";
import editorStyles from "../notes/editor/RichEditor.module.css?raw";
import global from "./global.css?raw";
import searchStyles from "../notes/SearchField.module.css?raw";
import tasksStyles from "../notes/TasksView.module.css?raw";

/**
 * Every sheet here is let through Vitest's CSS pipeline in `vite.config.ts`;
 * a blanked one reads as an empty string, which would make all of this
 * vacuously true.
 */
const MODULES: [string, string][] = [
  ["RichEditor.module.css", editorStyles],
  ["CodeNode.module.css", codeStyles],
  ["SearchField.module.css", searchStyles],
  ["TasksView.module.css", tasksStyles],
  ["TaskDetails.module.css", detailsStyles],
];

/** Rules as selector/body pairs, with comments taken out first. */
function rules(css: string): { selector: string; body: string }[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: (match[1] ?? "").trim().replace(/\s+/g, " "),
    body: match[2] ?? "",
  }));
}

/**
 * Turning the accent focus ring off takes `:focus-visible` in the selector.
 *
 * `global.css` draws it with a bare `:focus-visible` (brief 7.2), which is one
 * class's worth of specificity — the same as a CSS module's class on its own.
 * Ties are settled by order, and order is against the modules: `main.tsx`
 * imports `App` above `global.css`, so every component sheet is bundled before
 * it. A rule that says `.thing { outline: none }` therefore loses, silently,
 * and the ring comes back on something that asked not to have one.
 *
 * That is what put a blue box round the note editor's text, and round the one
 * check list line the caret was on — Lexical gives a check list item
 * `tabindex="-1"` and focuses it, so it is a focusable element inside the
 * writing. Qualifying the selector wins the tie on specificity instead of on
 * order, which is what every other suppression in the app already did.
 */
describe("the focus ring", () => {
  it("is drawn by global.css with a bare :focus-visible", () => {
    const ring = rules(global).find(({ body }) => /outline:\s*2px solid var\(--accent\)/.test(body));
    expect(ring?.selector).toBe(":focus-visible");
  });

  for (const [name, css] of MODULES) {
    it(`${name} only turns it off from a :focus selector`, () => {
      const unqualified = rules(css)
        .filter(({ body }) => /(^|;)\s*outline:\s*none/.test(body))
        .filter(({ selector }) => !selector.includes(":focus"))
        .map(({ selector }) => selector);
      expect(unqualified, `${name} would lose the tie with global.css`).toEqual([]);
    });
  }
});
