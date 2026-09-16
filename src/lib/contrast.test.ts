import { describe, expect, it } from "vitest";

import tokens from "../styles/tokens.css?raw";
import { blend, contrastRatio } from "./contrast";
import { NOTE_COLORS } from "./ipc";
import { PRIORITIES } from "./taskMeta";

/** Hue in degrees, enough to tell "these are different colours" from "these are not". */
function hue(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const span = max - Math.min(r, g, b);
  if (span === 0) {
    return 0;
  }
  const degrees =
    max === r ? ((g - b) / span) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return (degrees * 60 + 360) % 360;
}

/**
 * The palette as the app actually paints it: read from tokens.css rather than
 * copied, so a colour added or retuned there cannot skip this check.
 */
function tokenBlock(selector: RegExp): Map<string, string> {
  const block = selector.exec(tokens)?.[1] ?? "";
  return new Map(
    [
      ...block.matchAll(
        /--(note-[a-z]+-(?:bg|text)|priority-[a-z]+|surface|surface-sunken):\s*(#[0-9a-f]{6});/g,
      ),
    ].map(([, name = "", hex = ""]) => [name, hex]),
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

/**
 * Non-text contrast (WCAG 1.4.11): the priority flag is a small graphic that
 * carries meaning, so it needs 3:1 — not the 4.5 body text needs.
 */
const NON_TEXT = 3;

/**
 * The flag is drawn on a note's own colour, on the Tasks tab's sunken rows and on
 * the details sheet's segments, so every one of those is a background it has to
 * survive. This is the check that keeps the tokens honest: a retuned palette
 * colour or a new one fails here rather than in someone's eyes.
 */
describe("priority flag contrast", () => {
  const backgrounds = (theme: Map<string, string>): [string, string][] => [
    ...NOTE_COLORS.map((color): [string, string] => [
      `the ${color} note`,
      pair(theme, color)[0],
    ]),
    ["the panel", theme.get("surface") ?? ""],
    ["a sunken row", theme.get("surface-sunken") ?? ""],
  ];

  for (const priority of PRIORITIES) {
    for (const theme of ["light", "dark"] as const) {
      const tokenSet = theme === "light" ? LIGHT : DARK;
      const flag = tokenSet.get(`priority-${priority}`);

      it(`${priority} is defined in ${theme}, identically in both dark blocks`, () => {
        expect(flag).toMatch(/^#[0-9a-f]{6}$/);
        expect(DARK.get(`priority-${priority}`)).toBe(
          SYSTEM_DARK.get(`priority-${priority}`),
        );
      });

      for (const [where, background] of backgrounds(tokenSet)) {
        it(`${priority} is visible on ${where} in ${theme}`, () => {
          expect(background).toMatch(/^#[0-9a-f]{6}$/);
          expect(contrastRatio(background, flag ?? "")).toBeGreaterThanOrEqual(NON_TEXT);
        });
      }
    }
  }

  it("gives the three priorities separable hues, not just shades", () => {
    // Colour is never the only signal — the flag is filled for high and thinner
    // for low — but two priorities that read as the same colour would still make
    // the addition pointless.
    for (const theme of [LIGHT, DARK]) {
      const hues = PRIORITIES.map((priority) => hue(theme.get(`priority-${priority}`) ?? ""));
      for (let i = 0; i < hues.length; i += 1) {
        for (let j = i + 1; j < hues.length; j += 1) {
          expect(Math.abs((hues[i] ?? 0) - (hues[j] ?? 0))).toBeGreaterThanOrEqual(25);
        }
      }
    }
  });
});

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for a colour on itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#4a3f16", "#4a3f16")).toBeCloseTo(1, 5);
  });
});
