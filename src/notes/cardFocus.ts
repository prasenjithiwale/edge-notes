/**
 * Arrow-key movement between note cards (brief 6.11). Lives next to the cards
 * and reads the DOM rather than mirroring the focused index in the store: focus
 * is already the browser's state, and duplicating it would let the two disagree
 * after a delete or a re-sort.
 */
export function moveCardFocus(
  container: HTMLElement | null,
  direction: 1 | -1,
  /** What counts as a row here: note cards, or the Tasks tab's task rows. */
  selector = "[data-card]",
): boolean {
  if (!container) {
    return false;
  }
  const cards = Array.from(container.querySelectorAll<HTMLElement>(selector));
  if (cards.length === 0) {
    return false;
  }

  const active = document.activeElement;
  const current =
    active instanceof HTMLElement ? cards.indexOf(active) : -1;

  // With no card focused yet, Down enters the list at the top and Up at the
  // bottom. Otherwise movement stops at the ends rather than wrapping, so
  // holding an arrow key cannot cycle forever.
  const next =
    current === -1
      ? direction === 1
        ? 0
        : cards.length - 1
      : Math.min(Math.max(current + direction, 0), cards.length - 1);

  cards[next]?.focus();
  return true;
}
