/**
 * Whether the viewer has asked for less motion (brief 6.2).
 *
 * Guarded rather than assumed: `matchMedia` is missing in the test environment,
 * and a missing accessibility API should mean "animate normally", never a crash
 * that takes the editor down with it.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
