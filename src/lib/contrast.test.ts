import { describe, expect, it } from "vitest";

import { blend, contrastRatio } from "./contrast";

/** Brief 7.3, copied from tokens.css. Light and dark background/text pairs. */
const PALETTE = {
  yellow: { light: ["#fdf3c4", "#5c4a00"], dark: ["#4a3f16", "#f7e9a8"] },
  peach: { light: ["#fde2d2", "#6b3419"], dark: ["#4d2e1f", "#f8cdb5"] },
  pink: { light: ["#fadde7", "#6b2440"], dark: ["#4a2333", "#f5c3d4"] },
  lavender: { light: ["#e6e1fa", "#3a2f73"], dark: ["#312a55", "#d6cef7"] },
  blue: { light: ["#dcebfa", "#173f66"], dark: ["#1e3550", "#bfd9f5"] },
  mint: { light: ["#d9f2e6", "#1b5238"], dark: ["#1d3f31", "#bde8d2"] },
  gray: { light: ["#ecebe8", "#3a3936"], dark: ["#34332f", "#e3e2de"] },
} as const;

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
  for (const [name, themes] of Object.entries(PALETTE)) {
    for (const theme of ["light", "dark"] as const) {
      const [background, text] = themes[theme];

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
