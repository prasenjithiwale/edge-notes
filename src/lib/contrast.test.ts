import { describe, expect, it } from "vitest";

import tokens from "../styles/tokens.css?raw";
import { blend, contrastRatio } from "./contrast";
import { NOTE_COLORS } from "./ipc";

/**
 * The palette as the app actually paints it: read from tokens.css rather than
 * copied, so a colour added or retuned there cannot skip this check.
 */
function tokenBlock(selector: RegExp): Map<string, string> {
  const block = selector.exec(tokens)?.[1] ?? "";
  return new Map(
    [...block.matchAll(/--(note-[a-z]+-(?:bg|text)):\s*(#[0-9a-f]{6});/g)].map(
      ([, name = "", hex = ""]) => [name, hex],
    ),
  );
}

const LIGHT = tokenBlock(/^:root \{([^}]*)\}/m);
const DARK = tokenBlock(/^:root\[data-theme="dark"\] \{([^}]*)\}/m);
const SYSTEM_DARK = tokenBlock(/:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/);

function pair(theme: Map<string, string>, color: string): [string, string] {
  const background = theme.get(`note-${color}-bg`);
  const text = theme.get(`note-${color}-text`);
  if (background === undefined || text === undefined) {
    throw new Error(`tokens.css has no ${color} pair`);
  }
  return [background, text];
}

describe("the palette tokens", () => {
  it("define every palette colour in light and in both dark blocks, identically", () => {
    for (const color of NOTE_COLORS) {
      expect(() => pair(LIGHT, color)).not.toThrow();
      expect(pair(DARK, color)).toEqual(pair(SYSTEM_DARK, color));
    }
    expect(NOTE_COLORS).toHaveLength(16);
  });
});

/** WCAG AA for body text. */
const AA = 4.5;
/**
 * `--note-secondary-opacity` in tokens.css, which every piece of reduced-emphasis
 * text on a note now uses: the card preview, the untitled placeholder, the
 * editor's placeholder and its edited-time line. Keep the two in sync — this is
 * the check that the token stays above the AA threshold.
 */
const SECONDARY_OPACITY = 0.82;

describe("note palette contrast (brief 7.3)", () => {
  for (const name of NOTE_COLORS) {
    for (const theme of ["light", "dark"] as const) {
      const [background, text] = pair(theme === "light" ? LIGHT : DARK, name);

      it(`${name} card title meets AA in ${theme}`, () => {
        expect(contrastRatio(background, text)).toBeGreaterThanOrEqual(AA);
      });

      it(`${name} preview text meets AA in ${theme}`, () => {
        // The preview is the same colour at reduced opacity, so the contrast
        // that counts is of what is actually on screen.
        const effective = blend(text, background, SECONDARY_OPACITY);
        expect(contrastRatio(background, effective)).toBeGreaterThanOrEqual(AA);
      });

      it(`${name} edited-time line meets AA in ${theme}`, () => {
        const effective = blend(text, background, SECONDARY_OPACITY);
        expect(contrastRatio(background, effective)).toBeGreaterThanOrEqual(AA);
      });
    }
  }
});

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for a colour on itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#4a3f16", "#4a3f16")).toBeCloseTo(1, 5);
  });
});
