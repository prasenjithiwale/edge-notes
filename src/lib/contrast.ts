/**
 * WCAG contrast maths, so brief 7.3's "verify AA contrast on every note colour"
 * is checked by a test rather than by eye.
 */

/** sRGB hex (`#rrggbb`) to the 0–1 channels WCAG works in. */
function channels(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const int = Number.parseInt(value, 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff].map(
    (c) => c / 255,
  ) as [number, number, number];
}

/** WCAG 2.1 relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) =>
    c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The ratio between two colours, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/**
 * What a colour at `alpha` over `background` actually looks like. The card
 * preview and the editor's meta line are drawn at reduced opacity, so the
 * contrast that matters is of the blend, not of the token.
 */
export function blend(foreground: string, background: string, alpha: number): string {
  const fg = channels(foreground);
  const bg = channels(background);
  const mixed = fg.map((c, index) => {
    const behind = bg[index] ?? 0;
    return Math.round((c * alpha + behind * (1 - alpha)) * 255);
  });
  return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
