import { describe, expect, it } from "vitest";

import tokens from "./tokens.css?raw";
import { NOTE_COLORS } from "../lib/ipc";

/**
 * Aurora glass paints a note as glass lit by its colour (`--note-<c>-light`),
 * so a colour with no light would draw as plain glass and could not be told
 * from "none". Every palette entry needs one, defined once for both themes.
 */
describe("note light", () => {
  for (const color of NOTE_COLORS) {
    it(`${color} has exactly one light`, () => {
      const found = tokens.match(new RegExp(`--note-${color}-light:`, "g")) ?? [];
      expect(found).toHaveLength(1);
    });
  }

  it("leaves 'none' unlit", () => {
    expect(tokens).toContain("--note-none-light: transparent;");
  });
});
