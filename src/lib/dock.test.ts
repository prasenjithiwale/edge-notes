import { describe, expect, it } from "vitest";

import { cx } from "./cx";
import {
  isAnimatingPhase,
  isClosedPhase,
  isExpandedPhase,
  isOpenPhase,
  transitionFor,
} from "./dock";
import type { DockPhase } from "./ipc";

const PHASES: DockPhase[] = ["collapsed", "opening", "open", "closing"];

describe("isClosedPhase", () => {
  it("keeps the group off-edge while collapsed and closing", () => {
    expect(isClosedPhase("collapsed")).toBe(true);
    expect(isClosedPhase("closing")).toBe(true);
  });

  it("brings the group in while opening and open", () => {
    expect(isClosedPhase("opening")).toBe(false);
    expect(isClosedPhase("open")).toBe(false);
  });
});

describe("isOpenPhase", () => {
  it("flips the chevron as soon as the slide starts, not when it finishes", () => {
    expect(isOpenPhase("opening")).toBe(true);
    expect(isOpenPhase("open")).toBe(true);
    expect(isOpenPhase("closing")).toBe(false);
    expect(isOpenPhase("collapsed")).toBe(false);
  });
});

describe("isAnimatingPhase", () => {
  it("matches exactly the phases Rust waits for an acknowledgment on", () => {
    const animating = PHASES.filter(isAnimatingPhase);
    expect(animating).toEqual(["opening", "closing"]);
  });
});

describe("transitionFor", () => {
  it("uses the open and close curves for their own phases", () => {
    expect(transitionFor("opening")).toBe("open");
    expect(transitionFor("closing")).toBe("close");
  });

  it("never animates a settled phase", () => {
    expect(transitionFor("open")).toBe("none");
    expect(transitionFor("collapsed")).toBe("none");
  });

  it("animates only while an acknowledgment is expected", () => {
    for (const phase of PHASES) {
      expect(transitionFor(phase) === "none").toBe(!isAnimatingPhase(phase));
    }
  });
});

describe("cx", () => {
  it("drops the undefined a CSS Module lookup can return", () => {
    expect(cx("a", undefined, "b")).toBe("a b");
    expect(cx(undefined, null, false)).toBe("");
    expect(cx("only")).toBe("only");
  });
});

describe("isExpandedPhase", () => {
  it("is true for every phase where the panel is on screen", () => {
    expect(isExpandedPhase("opening")).toBe(true);
    expect(isExpandedPhase("open")).toBe(true);
    // Still on screen while sliding out, so Esc and the shortcuts still apply.
    expect(isExpandedPhase("closing")).toBe(true);
  });

  it("is false when collapsed, so Esc cannot toggle the panel open", () => {
    expect(isExpandedPhase("collapsed")).toBe(false);
  });
});
