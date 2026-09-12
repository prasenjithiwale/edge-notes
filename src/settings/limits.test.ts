import { describe, expect, it } from "vitest";

import { clampSetting, DELAY, PANEL_WIDTH } from "./limits";

describe("clampSetting", () => {
  it("keeps a value that is already in range", () => {
    expect(clampSetting("360", PANEL_WIDTH)).toBe(360);
  });

  it("clamps to the ends rather than rejecting", () => {
    expect(clampSetting("40", PANEL_WIDTH)).toBe(PANEL_WIDTH.min);
    expect(clampSetting("9999", PANEL_WIDTH)).toBe(PANEL_WIDTH.max);
  });

  it("falls back while the field is empty or unparseable", () => {
    // A number input reports "" mid-edit; sending NaN to Rust helps nobody.
    expect(clampSetting("", DELAY.open)).toBe(DELAY.open.fallback);
    expect(clampSetting("abc", DELAY.close)).toBe(DELAY.close.fallback);
  });

  it("uses the brief's panel range", () => {
    // Brief 6.4: 280–420, defaulting to 320.
    expect(PANEL_WIDTH).toEqual({ min: 280, max: 420, fallback: 320 });
  });
});
