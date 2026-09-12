// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { moveCardFocus } from "./cardFocus";

function list(count: number): HTMLElement {
  const container = document.createElement("div");
  for (let index = 0; index < count; index += 1) {
    const card = document.createElement("button");
    card.setAttribute("data-card", "");
    card.textContent = `card ${String(index)}`;
    container.appendChild(card);
  }
  document.body.appendChild(container);
  return container;
}

function cards(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-card]"));
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("moveCardFocus", () => {
  it("enters at the top on Down and at the bottom on Up", () => {
    const container = list(3);
    expect(moveCardFocus(container, 1)).toBe(true);
    expect(document.activeElement).toBe(cards(container)[0]);

    cards(container)[0]?.blur();
    moveCardFocus(container, -1);
    expect(document.activeElement).toBe(cards(container)[2]);
  });

  it("steps one card at a time", () => {
    const container = list(3);
    moveCardFocus(container, 1);
    moveCardFocus(container, 1);
    expect(document.activeElement).toBe(cards(container)[1]);
  });

  it("stops at the ends instead of wrapping", () => {
    // Holding an arrow key should rest at the end, not cycle forever.
    const container = list(2);
    moveCardFocus(container, 1);
    moveCardFocus(container, 1);
    moveCardFocus(container, 1);
    expect(document.activeElement).toBe(cards(container)[1]);

    moveCardFocus(container, -1);
    moveCardFocus(container, -1);
    expect(document.activeElement).toBe(cards(container)[0]);
  });

  it("reports that it did nothing when there are no cards", () => {
    // The caller uses this to decide whether to preventDefault.
    expect(moveCardFocus(list(0), 1)).toBe(false);
    expect(moveCardFocus(null, 1)).toBe(false);
  });
});
