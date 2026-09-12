// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { prefersReducedMotion } from "./motion";

// Captured as a descriptor rather than as the method itself, which would be an
// unbound reference to something that may not exist here at all.
const original = Object.getOwnPropertyDescriptor(window, "matchMedia");

afterEach(() => {
  if (original) {
    Object.defineProperty(window, "matchMedia", original);
  } else {
    Reflect.deleteProperty(window, "matchMedia");
  }
});

function stub(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches })),
  });
}

describe("prefersReducedMotion", () => {
  it("follows the media query when there is one", () => {
    stub(true);
    expect(prefersReducedMotion()).toBe(true);
    stub(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("says no rather than throwing where matchMedia is missing", () => {
    // jsdom has no matchMedia, and an absent accessibility API must not take the
    // editor down with it.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: undefined,
    });
    expect(prefersReducedMotion()).toBe(false);
  });
});
