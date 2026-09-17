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
        /--(note-[a-z]+-(?:bg|text)|priority-[a-z]+|code-[a-z]+|focus-running|surface|surface-sunken):\s*(#[0-9a-f]{6});/g,
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
    expect(NOTE_COLORS).toHaveLength(17);
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

/**
 * Syntax highlighting is the second agreed exception to brief 7.1, after the
 * priority flags. It is kept honest by the same rule: the block has its own
 * neutral surface, so there are two backgrounds rather than sixteen, and every
 * role has to be readable body text on both.
 */
describe("code block palette", () => {
  const ROLES = ["text", "comment", "string", "number", "keyword", "property"] as const;

  for (const theme of ["light", "dark"] as const) {
    const tokenSet = theme === "light" ? LIGHT : DARK;
    const background = tokenSet.get("code-bg");

    it(`has a code surface in ${theme}, identical in both dark blocks`, () => {
      expect(background).toMatch(/^#[0-9a-f]{6}$/);
      expect(DARK.get("code-bg")).toBe(SYSTEM_DARK.get("code-bg"));
    });

    for (const role of ROLES) {
      it(`${role} meets AA on the code surface in ${theme}`, () => {
        const colour = tokenSet.get(`code-${role}`);
        expect(colour).toMatch(/^#[0-9a-f]{6}$/);
        expect(DARK.get(`code-${role}`)).toBe(SYSTEM_DARK.get(`code-${role}`));
        expect(contrastRatio(background ?? "", colour ?? "")).toBeGreaterThanOrEqual(AA);
      });
    }
  }

  it("gives the roles separable hues, not just shades", () => {
    // Two roles that read as the same colour would make the exception pointless.
    for (const theme of [LIGHT, DARK]) {
      const coloured = ["comment", "string", "number", "keyword", "property"] as const;
      const hues = coloured.map((role) => hue(theme.get(`code-${role}`) ?? ""));
      for (let i = 0; i < hues.length; i += 1) {
        for (let j = i + 1; j < hues.length; j += 1) {
          const apart = Math.abs((hues[i] ?? 0) - (hues[j] ?? 0));
          expect(Math.min(apart, 360 - apart)).toBeGreaterThanOrEqual(25);
        }
      }
    }
  });
});

/**
 * Inline code keeps the note's own text colour and puts a wash behind it, so the
 * contrast that matters is of that text on the washed background — on every note
 * colour, in both themes.
 */
describe("inline code contrast", () => {
  const WASH: Record<"light" | "dark", { colour: string; alpha: number }> = {
    // `--code-inline-bg` in tokens.css. Keep the two in step.
    light: { colour: "#000000", alpha: 0.07 },
    dark: { colour: "#ffffff", alpha: 0.11 },
  };

  for (const name of NOTE_COLORS) {
    for (const theme of ["light", "dark"] as const) {
      it(`${name} inline code meets AA in ${theme}`, () => {
        const [background, text] = pair(theme === "light" ? LIGHT : DARK, name);
        const { colour, alpha } = WASH[theme];
        expect(contrastRatio(blend(colour, background, alpha), text)).toBeGreaterThanOrEqual(
          AA,
        );
      });
    }
  }
});

/**
 * The light on the collapsed tab. It is drawn on the tab's own surface, which is
 * `--surface` in both themes, and it is the one thing on screen while the panel
 * is away — so it is held to the same non-text bar as the priority flags.
 */
describe("the running-session light", () => {
  for (const theme of ["light", "dark"] as const) {
    const tokenSet = theme === "light" ? LIGHT : DARK;

    it(`is defined in ${theme}, identically in both dark blocks`, () => {
      expect(tokenSet.get("focus-running")).toMatch(/^#[0-9a-f]{6}$/);
      expect(DARK.get("focus-running")).toBe(SYSTEM_DARK.get("focus-running"));
    });

    it(`is visible on the tab in ${theme}`, () => {
      const surface = tokenSet.get("surface") ?? "";
      expect(contrastRatio(surface, tokenSet.get("focus-running") ?? "")).toBeGreaterThanOrEqual(
        NON_TEXT,
      );
    });

    it(`does not read as a priority flag in ${theme}`, () => {
      // Red already means "high priority" on a task. The two are never on screen
      // together, but they should not be the same red either.
      expect(tokenSet.get("focus-running")).not.toBe(tokenSet.get("priority-high"));
    });
  }
});

/**
 * A note with no colour still has to look like a note.
 *
 * "No colour" is a palette entry rather than an absent one, so it goes through
 * every check above — but those all measure text against its own background, and
 * the thing that could go wrong here is different: a neutral card on a neutral
 * panel, in either theme, disappearing into it. It is also the one entry that
 * sits beside `gray`, and two neutrals of the same lightness cannot be told
 * apart by contrast at all — so this checks the hairline exists as well.
 */
describe("a note with no colour", () => {
  /** Enough of a step to read as a card. Two surfaces at 3:1 would look harsh. */
  const VISIBLE = 1.15;

  for (const theme of ["light", "dark"] as const) {
    const tokenSet = theme === "light" ? LIGHT : DARK;

    it(`stands off the panel in ${theme}`, () => {
      const card = tokenSet.get("note-none-bg");
      const panel = tokenSet.get("surface");
      expect(card).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrastRatio(panel ?? "", card ?? "")).toBeGreaterThanOrEqual(VISIBLE);
    });

    it(`is not the same card as gray in ${theme}`, () => {
      expect(tokenSet.get("note-none-bg")).not.toBe(tokenSet.get("note-gray-bg"));
    });
  }

  it("carries a hairline, which is what gray does not", () => {
    // Contrast cannot separate two neutrals of one lightness; the edge can.
    expect(tokens).toMatch(/--note-none-edge:/);
    expect(tokens).not.toMatch(/--note-gray-edge:/);
  });

  it("is the only entry with an edge, so the fallback stays transparent", () => {
    const edges = [...tokens.matchAll(/--note-([a-z]+)-edge:/g)].map(([, name]) => name);
    expect(new Set(edges)).toEqual(new Set(["none"]));
  });
});

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for a colour on itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#4a3f16", "#4a3f16")).toBeCloseTo(1, 5);
  });
});
