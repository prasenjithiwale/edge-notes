import { describe, expect, it } from "vitest";

import rust from "../../src-tauri/src/db/settings.rs?raw";
import { TAB_SCALES } from "../store/settings";

/**
 * The tab is three things at once: a window and a hit area, both Rust's, and a
 * painted pill, which is CSS's. One factor scales all three, and it is written
 * down on both sides of the boundary — so this is the check that the two lists
 * stay the same. A tab whose window and pill disagreed would either be a pill
 * floating in a box too big for it or one clipped by a box too small.
 */
describe("the tab size scales", () => {
  it("are the same in Rust as in the frontend", () => {
    const block = /pub fn scale\(self\) -> f64 \{[\s\S]*?\n {4}\}/.exec(rust)?.[0] ?? "";
    expect(block, "TabSize::scale not found in settings.rs").not.toBe("");

    for (const [size, scale] of Object.entries(TAB_SCALES)) {
      const name = `${(size[0] ?? "").toUpperCase()}${size.slice(1)}`;
      const found = new RegExp(`Self::${name} => ([0-9.]+)`).exec(block)?.[1];
      expect(found, `Rust has no scale for ${size}`).toBeDefined();
      expect(Number(found), `${size} disagrees across the boundary`).toBe(scale);
    }
  });

  it("cover exactly the three sizes the setting offers", () => {
    expect(Object.keys(TAB_SCALES).sort()).toEqual(["large", "medium", "small"]);
  });

  it("grow in the order they are named, and medium is the untouched default", () => {
    expect(TAB_SCALES.small).toBeLessThan(TAB_SCALES.medium);
    expect(TAB_SCALES.medium).toBeLessThan(TAB_SCALES.large);
    expect(TAB_SCALES.medium).toBe(1);
  });
});
